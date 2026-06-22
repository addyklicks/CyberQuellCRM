# Telegram Follow-Up Reminders

This project stores Telegram reminder settings in each user document:

- `telegramChatId`
- `telegramRemindersEnabled`

The CRM treats `firstFollowup` and `secondFollowup` as due dates. A reminder is due when:

- `firstFollowup` is today or earlier and the lead is still in `new` or `first-followup`
- `secondFollowup` is today or earlier and the lead is still in `new`, `first-followup`, or `second-followup`

## 1. Create A Telegram Bot

1. Open Telegram and message `@BotFather`.
2. Run `/newbot`.
3. Copy the bot token.
4. Send a message to your new bot.
5. Open this URL in a browser:

```text
https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
```

6. Copy your `chat.id`.
7. In the CRM, open Team and save that chat ID under Telegram Reminders.

## 2. Create A Google Apps Script

Create a new Apps Script project and add this code. Replace:

- `TELEGRAM_BOT_TOKEN`
- `FIREBASE_PROJECT_ID`
- `SERVICE_ACCOUNT_CLIENT_EMAIL`
- `SERVICE_ACCOUNT_PRIVATE_KEY`

```javascript
const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
const FIREBASE_PROJECT_ID = 'cyberquellcrm';
const SERVICE_ACCOUNT_CLIENT_EMAIL = 'YOUR_SERVICE_ACCOUNT_CLIENT_EMAIL';
const SERVICE_ACCOUNT_PRIVATE_KEY = `YOUR_SERVICE_ACCOUNT_PRIVATE_KEY`;

function sendFollowupReminders() {
  const token = getAccessToken_();
  const users = firestoreRunQuery_('users', token, [
    fieldFilter_('telegramRemindersEnabled', 'EQUAL', { booleanValue: true })
  ]);
  const leads = firestoreRunQuery_('leads', token, []);
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  users.forEach(user => {
    const chatId = stringValue_(user.fields.telegramChatId);
    if (!chatId) return;

    const assignedLeads = leads.filter(lead => {
      const assignee = stringValue_(lead.fields.assignee);
      return !assignee || assignee === user.name.split('/').pop();
    });

    const due = assignedLeads.flatMap(lead => getDueFollowups_(lead, today));
    if (!due.length) return;

    const message = due.map(item => [
      `Follow-up due: ${item.followup}`,
      `Lead: ${item.name}`,
      `Company: ${item.company || '-'}`,
      `Contact: ${item.contact || item.email || '-'}`,
      `Service: ${item.service || '-'}`,
      `Stage: ${item.status}`
    ].join('\n')).join('\n\n');

    sendTelegram_(chatId, message);
  });
}

function getDueFollowups_(lead, today) {
  const fields = lead.fields || {};
  const status = stringValue_(fields.status) || 'new';
  const items = [];

  const firstFollowup = stringValue_(fields.firstFollowup);
  if (firstFollowup && firstFollowup <= today && ['new', 'first-followup'].includes(status)) {
    items.push(buildReminder_(lead, 'First Follow-up'));
  }

  const secondFollowup = stringValue_(fields.secondFollowup);
  if (secondFollowup && secondFollowup <= today && ['new', 'first-followup', 'second-followup'].includes(status)) {
    items.push(buildReminder_(lead, 'Second Follow-up'));
  }

  return items;
}

function buildReminder_(lead, followup) {
  const fields = lead.fields || {};
  return {
    followup,
    name: stringValue_(fields.name) || 'Untitled lead',
    company: stringValue_(fields.company),
    contact: stringValue_(fields.contactName),
    email: stringValue_(fields.email),
    service: stringValue_(fields.serviceType),
    status: stringValue_(fields.status)
  };
}

function sendTelegram_(chatId, text) {
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  });
}

function firestoreRunQuery_(collection, token, filters) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const structuredQuery = {
    from: [{ collectionId: collection }]
  };

  if (filters.length) {
    structuredQuery.where = filters.length === 1
      ? filters[0]
      : { compositeFilter: { op: 'AND', filters } };
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify({ structuredQuery })
  });

  return JSON.parse(response.getContentText())
    .map(row => row.document)
    .filter(Boolean);
}

function fieldFilter_(fieldPath, op, value) {
  return {
    fieldFilter: {
      field: { fieldPath },
      op,
      value
    }
  };
}

function stringValue_(field) {
  return field && field.stringValue ? field.stringValue : '';
}

function getAccessToken_() {
  const now = Math.floor(Date.now() / 1000);
  const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: SERVICE_ACCOUNT_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(`${header}.${claim}`, SERVICE_ACCOUNT_PRIVATE_KEY)
  );
  const jwt = `${header}.${claim}.${signature}`;

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }
  });

  return JSON.parse(response.getContentText()).access_token;
}
```

## 3. Schedule It

In Apps Script:

1. Go to Triggers.
2. Add trigger.
3. Function: `sendFollowupReminders`
4. Event source: Time-driven
5. Frequency: daily or hourly

Hourly is useful if follow-ups are managed throughout the day.
