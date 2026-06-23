# Telegram Follow-Up Reminders

This setup uses Google Apps Script, Firestore REST, and Telegram Bot API. It does not require Firebase Cloud Functions or the Firebase Blaze plan.

## Reminder Logic

The script runs every day at 11:00 AM.

- If `firstFollowup` exists and is today or earlier, Telegram sends a first-follow-up reminder.
- If `firstFollowup` is still present after the reminder, the lead is treated as missed.
- When a missed first-follow-up reminder is sent, `secondFollowup` is pushed one day ahead if it exists.
- The script keeps reminding every day at 11:00 AM until `firstFollowup` is removed.
- Once `firstFollowup` is removed, the script watches `secondFollowup`.
- If `secondFollowup` exists and is today or earlier, Telegram sends a second-follow-up reminder every day until it is removed.
- If `secondFollowup` is empty, no second reminder is sent.

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

Create a new Apps Script project and add this code. Secrets are read from Apps Script Properties so the bot token and service account key are not hard-coded in the script.

Before running the script, add these Script Properties:

| Property | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token |
| `FIREBASE_PROJECT_ID` | `cyberquellcrm` |
| `SERVICE_ACCOUNT_CLIENT_EMAIL` | `telegram-reminders@cyberquellcrm.iam.gserviceaccount.com` |
| `SERVICE_ACCOUNT_PRIVATE_KEY` | The `private_key` value from the downloaded service account JSON |

```javascript
const REMINDER_HOUR = 11;

function config_() {
  const props = PropertiesService.getScriptProperties();
  return {
    telegramBotToken: props.getProperty('TELEGRAM_BOT_TOKEN'),
    firebaseProjectId: props.getProperty('FIREBASE_PROJECT_ID'),
    serviceAccountClientEmail: props.getProperty('SERVICE_ACCOUNT_CLIENT_EMAIL'),
    serviceAccountPrivateKey: props.getProperty('SERVICE_ACCOUNT_PRIVATE_KEY')
  };
}

function installDailyReminderTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'sendFollowupReminders')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('sendFollowupReminders')
    .timeBased()
    .everyDays(1)
    .atHour(REMINDER_HOUR)
    .create();
}

function sendFollowupReminders() {
  const token = getAccessToken_();
  const users = firestoreRunQuery_('users', token, [
    fieldFilter_('telegramRemindersEnabled', 'EQUAL', { booleanValue: true })
  ]);
  const leads = firestoreRunQuery_('leads', token, []);
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  users.forEach(user => {
    const userId = user.name.split('/').pop();
    const chatId = stringValue_(user.fields.telegramChatId);
    if (!chatId) return;

    const reminders = [];

    leads.forEach(lead => {
      const assignee = stringValue_(lead.fields.assignee);
      if (assignee && assignee !== userId) return;

      const reminder = getDueReminder_(lead, today);
      if (!reminder) return;

      reminders.push(reminder);

      if (reminder.kind === 'first' && reminder.secondFollowup) {
        pushSecondFollowupOneDay_(lead.name, reminder.secondFollowup, token);
      }
    });

    if (!reminders.length) return;

    sendTelegram_(chatId, buildTelegramMessage_(reminders));
  });
}

function getDueReminder_(lead, today) {
  const fields = lead.fields || {};
  const firstFollowup = stringValue_(fields.firstFollowup);
  const secondFollowup = stringValue_(fields.secondFollowup);

  if (firstFollowup && firstFollowup <= today) {
    return buildReminder_(lead, {
      kind: 'first',
      label: 'First Follow-up',
      dueDate: firstFollowup,
      missed: firstFollowup < today,
      secondFollowup
    });
  }

  if (!firstFollowup && secondFollowup && secondFollowup <= today) {
    return buildReminder_(lead, {
      kind: 'second',
      label: 'Second Follow-up',
      dueDate: secondFollowup,
      missed: secondFollowup < today,
      secondFollowup: ''
    });
  }

  return null;
}

function buildReminder_(lead, reminder) {
  const fields = lead.fields || {};
  return {
    ...reminder,
    name: stringValue_(fields.name) || 'Untitled lead',
    company: stringValue_(fields.company),
    contact: stringValue_(fields.contactName),
    email: stringValue_(fields.email),
    phone: stringValue_(fields.phone),
    service: stringValue_(fields.serviceType),
    status: stringValue_(fields.status)
  };
}

function buildTelegramMessage_(reminders) {
  return reminders.map(item => {
    const missedText = item.missed ? 'MISSED - still pending' : 'Due today';
    const lines = [
      `${item.label}: ${missedText}`,
      `Lead: ${item.name}`,
      `Company: ${item.company || '-'}`,
      `Contact: ${item.contact || item.email || item.phone || '-'}`,
      `Service: ${item.service || '-'}`,
      `Stage: ${item.status || '-'}`,
      `Due date: ${item.dueDate}`
    ];

    if (item.kind === 'first' && item.secondFollowup) {
      lines.push('Second follow-up moved one day ahead because first follow-up is still pending.');
    }

    return lines.join('\n');
  }).join('\n\n');
}

function pushSecondFollowupOneDay_(leadDocumentName, secondFollowup, token) {
  const nextDate = addDays_(secondFollowup, 1);
  const url = `https://firestore.googleapis.com/v1/${leadDocumentName}?updateMask.fieldPaths=secondFollowup&updateMask.fieldPaths=updatedAt`;

  UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify({
      fields: {
        secondFollowup: { stringValue: nextDate },
        updatedAt: { timestampValue: new Date().toISOString() }
      }
    })
  });
}

function addDays_(yyyyMmDd, days) {
  const date = new Date(`${yyyyMmDd}T00:00:00`);
  date.setDate(date.getDate() + days);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function sendTelegram_(chatId, text) {
  const { telegramBotToken } = config_();
  UrlFetchApp.fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
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
  const { firebaseProjectId } = config_();
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents:runQuery`;
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
  const { serviceAccountClientEmail, serviceAccountPrivateKey } = config_();
  const now = Math.floor(Date.now() / 1000);
  const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: serviceAccountClientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(`${header}.${claim}`, serviceAccountPrivateKey)
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

## 3. Schedule It For 11 AM

In Apps Script:

1. Open Project Settings.
2. Set timezone to `Asia/Kolkata`.
3. Add the Script Properties listed above.
4. Run `installDailyReminderTrigger` once.
5. Approve the requested permissions.

That creates a daily trigger for `sendFollowupReminders` at around 11:00 AM in the script timezone.

Apps Script time-driven triggers can run within a small window around the selected hour, not necessarily exactly at 11:00:00.
