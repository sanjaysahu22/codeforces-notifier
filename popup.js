
document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup loaded');

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    console.log('Refresh button clicked');
    

    document.getElementById('contestList').innerHTML = '<div class="empty-state">Refreshing...</div>';
    const userEmailInput = document.getElementById('userEmail');
    const saveEmailBtn = document.getElementById('saveEmailBtn');
    const testEmailBtn = document.getElementById('testEmailBtn');
    const emailEnabledCheckbox = document.getElementById('emailEnabled');

    try {
      await chrome.runtime.sendMessage({ action: 'scrapeNow' });
    } catch (e) {
      console.log('Message sending note:', e);
    }
    chrome.storage.local.get(['userEmail','emailEnabled'], (res) => {
    if (res.userEmail) userEmailInput.value = res.userEmail;
    emailEnabledCheckbox.checked = !!res.emailEnabled;
  });

  saveEmailBtn.addEventListener('click', () => {
    const email = userEmailInput.value.trim();
    chrome.storage.local.set({ userEmail: email }, () => {
      // small UI feedback
      saveEmailBtn.textContent = 'Saved';
      setTimeout(() => saveEmailBtn.textContent = 'Save', 1200);
    });
  });

    emailEnabledCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ emailEnabled: emailEnabledCheckbox.checked });
  });

  testEmailBtn.addEventListener('click', async () => {
    const email = userEmailInput.value.trim();
    if (!email) {
      testEmailBtn.textContent = 'Enter email';
      setTimeout(() => testEmailBtn.textContent = 'Send test', 1200);
      return;
    }
    // Ask background to send a test email (background will call worker)
    chrome.runtime.sendMessage({ action: 'sendTestEmail', email }, (resp) => {
      testEmailBtn.textContent = 'Sent';
      setTimeout(() => testEmailBtn.textContent = 'Send test', 1400);
    });
  });
    setTimeout(() => {
      loadContests();
    }, 2000);
  });
  
  loadContests();
  
  setInterval(loadContests, 30000);
});

async function loadContests() {
  const contestList = document.getElementById('contestList');
  contestList.innerHTML = '<div class="empty-state">Loading contests...</div>';
  
  try {
    console.log('Loading contests from storage...');
    
    const result = await chrome.storage.local.get('trackedContests');
    const trackedContests = result.trackedContests || {};
    
    console.log('Storage result:', result);
    console.log('Tracked contests:', trackedContests);
    
    const contestIds = Object.keys(trackedContests);
    console.log('Contest IDs:', contestIds);
    
    if (contestIds.length === 0) {
      contestList.innerHTML = '<div class="empty-state">No upcoming contests found.<br><br>The extension will automatically check for new contests every 15 minutes.<br><br>Try clicking "Refresh Now"!</div>';
      updateStats(0, null);
      return;
    }
    
    // Convert to array and sort by start time
    const contests = contestIds
      .map(id => ({
        id: parseInt(id),
        ...trackedContests[id]
      }))
      .sort((a, b) => a.startTime - b.startTime);
    
    console.log('Sorted contests:', contests);
    
    // Update stats
    const nextContest = contests[0];
    updateStats(contests.length, nextContest);
    
    // Display contests
    contestList.innerHTML = '';
    contests.forEach(contest => {
      const item = createContestItem(contest);
      contestList.appendChild(item);
    });
    
  } catch (error) {
    console.error('Error loading contests:', error);
    contestList.innerHTML = '<div class="empty-state">Error loading contests.<br><br>Check console for details.</div>';
  }
}

function updateStats(total, nextContest) {
  document.getElementById('totalContests').textContent = total;
  
  if (nextContest) {
    const timeUntil = getTimeUntilString(nextContest.startTime);
    document.getElementById('nextContest').textContent = timeUntil;
  } else {
    document.getElementById('nextContest').textContent = '-';
  }
}

function getTimeUntilString(startTime) {
  const now = Date.now();
  const diff = startTime - now;
  
  if (diff < 0) return 'Started';
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  
  return `${minutes}m`;
}

function createContestItem(contest) {
  const div = document.createElement('div');
  div.className = 'contest-item';
  
  const name = document.createElement('div');
  name.className = 'contest-name';
  name.textContent = contest.name;
  
  const timeDiv = document.createElement('div');
  timeDiv.className = 'contest-time';
  
  const startDate = new Date(contest.startTime);
  const timeStr = formatDate(startDate);
  
  const remaining = document.createElement('span');
  remaining.className = 'time-remaining';
  remaining.textContent = getTimeRemaining(contest.startTime);
  
  timeDiv.innerHTML = `📅 ${timeStr} • `;
  timeDiv.appendChild(remaining);
  
  const notifications = document.createElement('div');
  notifications.className = 'notifications';
  
  const intervals = [
    { key: '12hr', label: '12hr', icon: '🕐' },
    { key: '3hr', label: '3hr', icon: '🕒' },
    { key: '30min', label: '30min', icon: '⏰' }
  ];
  
  intervals.forEach(({ key, label, icon }) => {
    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    if (contest[key]) {
      badge.classList.add('sent');
      badge.innerHTML = `✓ ${label}`;
    } else {
      badge.innerHTML = `${icon} ${label}`;
    }
    notifications.appendChild(badge);
  });
  
  div.appendChild(name);
  div.appendChild(timeDiv);
  div.appendChild(notifications);
  
  return div;
}

function getTimeRemaining(startTime) {
  const now = Date.now();
  const diff = startTime - now;
  
  if (diff < 0) return 'Contest Started!';
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) {
    return `in ${days}d ${hours}h`;
  }
  
  if (hours > 0) {
    return `in ${hours}h ${minutes}m`;
  }
  
  return `in ${minutes} minutes`;
}

function formatDate(date) {
  const options = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };
  return date.toLocaleString('en-US', options);
}

// Listen for background messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'contestsUpdated') {
    loadContests();
  }
});