// background.js

// Initialize on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Codeforces Notifier installed');
  // Check for contests every 15 minutes
  chrome.alarms.create('scrapeContests', { periodInMinutes: 15 });
  scrapeAndScheduleContests();
});

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'scrapeContests') {
    scrapeAndScheduleContests();
  } else if (alarm.name.startsWith('notify_')) {
    handleNotification(alarm.name);
  }
});

// Scrape contests page and schedule notifications
async function scrapeAndScheduleContests() {
  try {
    console.log('Fetching Codeforces contests...');
    
    // Use Codeforces API directly - more reliable than HTML scraping
    const response = await fetch('https://codeforces.com/api/contest.list');
    const data = await response.json();
    
    if (data.status !== 'OK') {
      console.error('API returned error status');
      return;
    }
    
    // Get upcoming contests
    const contests = data.result
      .filter(c => c.phase === 'BEFORE')
      .map(c => ({
        id: c.id,
        name: c.name,
        startTime: c.startTimeSeconds * 1000
      }));
    
    console.log(`Found ${contests.length} upcoming contests`);
    
    // Get existing tracked contests
    const { trackedContests = {} } = await chrome.storage.local.get('trackedContests');
    
    const now = Date.now();
    let newContestsAdded = false;
    
    for (const contest of contests) {
      const { id, name, startTime } = contest;
      
      // Only track future contests
      if (startTime > now) {
        // Check if this is a new contest
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
        
        // Schedule notifications for this contest
        scheduleNotificationsForContest(contest, trackedContests[id]);
      }
    }
    
    // Clean up old contests (started more than 24 hours ago)
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    for (const id in trackedContests) {
      if (trackedContests[id].startTime < oneDayAgo) {
        delete trackedContests[id];
        // Clear associated alarms
        clearAlarmsForContest(id);
      }
    }
    
    // Save updated contests
    await chrome.storage.local.set({ trackedContests });
    
    if (newContestsAdded) {
      // Show notification for new contests
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



// Schedule notifications for a specific contest
function scheduleNotificationsForContest(contest, notificationState) {
  const { id, startTime } = contest;
  const now = Date.now();
  
  const intervals = [
    { key: '12hr', time: 12 * 60 * 60 * 1000, label: '12 hours' },
    { key: '3hr', time: 3 * 60 * 60 * 1000, label: '3 hours' },
    { key: '30min', time: 30 * 60 * 1000, label: '30 minutes' }
  ];
  
  intervals.forEach(({ key, time, label }) => {
    const notifyTime = startTime - time;
    
    // Schedule if time hasn't passed and notification hasn't been sent
    if (notifyTime > now && !notificationState[key]) {
      const alarmName = `notify_${id}_${key}`;
      chrome.alarms.create(alarmName, { when: notifyTime });
      console.log(`Scheduled ${label} notification for contest ${id} at ${new Date(notifyTime)}`);
    }
  });
}

// Handle notification trigger
async function handleNotification(alarmName) {
  const parts = alarmName.split('_');
  const contestId = parseInt(parts[1]);
  const intervalKey = parts[2];
  
  try {
    const { trackedContests = {} } = await chrome.storage.local.get('trackedContests');
    const contest = trackedContests[contestId];
    
    if (!contest) return;
    
    const timeLabels = {
      '12hr': '12 hours',
      '3hr': '3 hours',
      '30min': '30 minutes'
    };
    
    // Send notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'Codeforces Contest Reminder',
      message: `"${contest.name}" starts in ${timeLabels[intervalKey]}!`,
      priority: 2,
      requireInteraction: intervalKey === '30min' // Keep 30min notification until dismissed
    });
    
    // Mark notification as sent
    contest[intervalKey] = true;
    trackedContests[contestId] = contest;
    await chrome.storage.local.set({ trackedContests });
    
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

// Clear all alarms for a contest
async function clearAlarmsForContest(contestId) {
  const alarms = await chrome.alarms.getAll();
  alarms.forEach(alarm => {
    if (alarm.name.includes(`_${contestId}_`)) {
      chrome.alarms.clear(alarm.name);
    }
  });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);
  
  if (request.action === 'scrapeNow') {
    console.log('Manual scrape triggered');
    scrapeAndScheduleContests().then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }
});

