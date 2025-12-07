// background.js

// ---------------------------
//  EMAIL CONFIG
// ---------------------------
const RESEND_WORKER_URL = "https://codeforces-email-worker.sanjaysahu6243.workers.dev/send";

// send email via Cloudflare Worker
async function sendEmailThroughWorker({ to, subject, html, text }) {
  try {
    const resp = await fetch(RESEND_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html, text })
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.warn("Email worker error:", data);
      return { ok: false, data };
    }
    return { ok: true, data };
  } catch (e) {
    console.error("Failed to send email:", e);
    return { ok: false, error: e.message };
  }
}

// simple helpers
function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function formatDate(time) {
  return new Date(time).toLocaleString();
}

// ----------------------------------------------
//   EXTENSION INITIALIZATION
// ----------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  console.log('Codeforces Notifier installed');

  // Run every 15 minutes
  chrome.alarms.create('scrapeContests', { periodInMinutes: 15 });

  scrapeAndScheduleContests();
});

// ----------------------------------------------
//   ALARM LISTENER
// ----------------------------------------------
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'scrapeContests') {
    scrapeAndScheduleContests();
  } else if (alarm.name.startsWith('notify_')) {
    handleNotification(alarm.name);
  }
});

// ----------------------------------------------
//   SCRAPE & STORE CONTESTS
// ----------------------------------------------
async function scrapeAndScheduleContests() {
  try {
    console.log('Fetching Codeforces contests...');
    
    const response = await fetch('https://codeforces.com/api/contest.list');
    const data = await response.json();
    
    if (data.status !== 'OK') {
      console.error('API returned error status');
      return;
    }
    
    const contests = data.result
      .filter(c => c.phase === 'BEFORE')
      .map(c => ({
        id: c.id,
        name: c.name,
        startTime: c.startTimeSeconds * 1000
      }));
    
    console.log(`Found ${contests.length} upcoming contests`);
    
    const { trackedContests = {} } = await chrome.storage.local.get('trackedContests');
    
    const now = Date.now();
    let newContestsAdded = false;
    
    for (const contest of contests) {
      const { id, name, startTime } = contest;
      
      if (startTime > now) {
        if (!trackedContests[id]) {
          console.log(`New contest found: ${name}`);
          trackedContests[id] = {
            name: name,
            startTime: startTime,
            added: Date.now(),
            '12hr': false,
            '3hr': false,
            '30min': false
          };
          newContestsAdded = true;
        }
        
        scheduleNotificationsForContest(contest, trackedContests[id]);
      }
    }
    
    // remove expired contests
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    for (const id in trackedContests) {
      if (trackedContests[id].startTime < oneDayAgo) {
        delete trackedContests[id];
        clearAlarmsForContest(id);
      }
    }
    
    await chrome.storage.local.set({ trackedContests });
    
    if (newContestsAdded) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'New Codeforces Contest!',
        message: `New contest(s) detected. Click the extension icon to view.`,
        priority: 1
      });
    }
    
  } catch (error) {
    console.error('Error scraping contests:', error);
  }
}

// ----------------------------------------------
//   SCHEDULE NOTIFICATIONS
// ----------------------------------------------
function scheduleNotificationsForContest(contest, state) {
  const { id, startTime } = contest;
  const now = Date.now();
  
  const intervals = [
    { key: '12hr', time: 12 * 60 * 60 * 1000, label: '12 hours' },
    { key: '3hr', time: 3 * 60 * 60 * 1000, label: '3 hours' },
    { key: '30min', time: 30 * 60 * 1000, label: '30 minutes' }
  ];
  
  intervals.forEach(({ key, time }) => {
    const notifyTime = startTime - time;
    
    if (notifyTime > now && !state[key]) {
      const alarmName = `notify_${id}_${key}`;
      chrome.alarms.create(alarmName, { when: notifyTime });
      console.log(`Scheduled ${key} notification for ${id} at`, new Date(notifyTime));
    }
  });
}

// ----------------------------------------------
//   HANDLE NOTIFICATION & SEND EMAIL
// ----------------------------------------------
async function handleNotification(alarmName) {
  const parts = alarmName.split('_');
  const contestId = parseInt(parts[1]);
  const intervalKey = parts[2];
  
  try {
    const { trackedContests = {} } = await chrome.storage.local.get('trackedContests');
    const contest = trackedContests[contestId];
    if (!contest) return;
    
    const labels = {
      '12hr': '12 hours',
      '3hr': '3 hours',
      '30min': '30 minutes'
    };
    
    // Show browser notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'Codeforces Contest Reminder',
      message: `"${contest.name}" starts in ${labels[intervalKey]}!`,
      priority: 2,
      requireInteraction: intervalKey === '30min'
    });

    // ------------------------------------------
    // SEND EMAIL NOTIFICATION IF ENABLED
    // ------------------------------------------
    chrome.storage.local.get(["emailEnabled", "userEmail"], async (res) => {
      if (res.emailEnabled && res.userEmail) {
        const to = res.userEmail;
        const subject = `Codeforces Reminder — ${contest.name}`;
        const html = `
          <h2>${escapeHtml(contest.name)}</h2>
          <p>Starts in <b>${labels[intervalKey]}</b>.</p>
          <p><b>Start Time:</b> ${formatDate(contest.startTime)}</p>
          <p>Visit: <a href="https://codeforces.com/contest/${contestId}">Contest Link</a></p>
        `;

        await sendEmailThroughWorker({ to, subject, html });
      }
    });

    // mark sent
    contest[intervalKey] = true;
    trackedContests[contestId] = contest;
    await chrome.storage.local.set({ trackedContests });
    
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

// ----------------------------------------------
// REMOVE OLD ALARMS
// ----------------------------------------------
async function clearAlarmsForContest(contestId) {
  const alarms = await chrome.alarms.getAll();
  alarms.forEach(alarm => {
    if (alarm.name.includes(`_${contestId}_`)) {
      chrome.alarms.clear(alarm.name);
    }
  });
}

// ----------------------------------------------
// POPUP MESSAGES
// ----------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendTestEmail') {
    const to = request.email;
    const subject = 'Codeforces Notifier — test email';
    const html = `<p>This is a test email from Codeforces Notifier extension.</p>`;
    sendEmailThroughWorker({ to, subject, html, contestId: 'test' }).then((r) => {
      sendResponse({ ok: r.ok });
    });
    return true; // async
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Received message:", request);

  // manual refresh
  if (request.action === "scrapeNow") {
    scrapeAndScheduleContests().then(() => sendResponse({ success: true }));
    return true;
  }

  // test email
  if (request.action === "sendTestEmail") {
    const subject = "Codeforces Notifier — Test Email";
    const html = `<p>Your test email was sent successfully.</p>`;

    sendEmailThroughWorker({
      to: request.email,
      subject,
      html
    }).then(() => sendResponse({ ok: true }));

    return true;
  }
});
