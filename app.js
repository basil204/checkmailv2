// index.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3000;

const SMTP_API_KEY = 'smtplabs_YD2ceJHq5a8GaPjuxfX7hzsjAD7MQbm8Q8qJUiiypGNKUcaq';
const SMTP_BASE_URL = 'https://api.smtp.dev';
const ENCRYPTION_KEY = Buffer.from('12345678901234567890123456789012');
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function generateRandomUsername(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const tokenRegex = /^https:\/\/tokenized\.play\.google\.com\/eacquire\/.*?(.*)%3Ag1\.(.*?)%22%2C21%5D/;

const sources = [
  "Không thay đổi", "100gb", "100gb.annual", "200gb", "200gb.annual",
  "2tb", "2tb.annual", "2tb.ai", "5tb", "5tb.annual", "10tb", "20tb", "30tb",
  "100gb.1month_eft", "100gb.2months_eft", "100gb.3months_eft", "100gb.9months_eft", "100gb.1year_eft",
  "100gb.annual.1month_eft", "100gb.annual.3months_eft", "100gb.annual.1year_eft",
  "200gb.1month_eft", "200gb.3months_eft", "200gb.1year_eft", "200gb.annual.1month_eft", "200gb.annual.3months_eft",
  "2tb.ai.1month_eft", "2tb.ai.2months_eft", "2tb.1month_eft", "2tb.3months_eft", "2tb.6months_eft",
  "2tb.annual.1month_eft", "2tb.annual.3months_eft"
];

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/TrialGoogle', (req, res) => {
  res.render('TrialGoogle', { sources });
});

app.get('/createmail', (req, res) => {
  res.render('create-email');
});

app.post('/process', (req, res) => {
  const { inputString, sourceRadio, replaceRadio } = req.body;
  if (!tokenRegex.test(inputString)) {
    return res.send({ error: '❌ Token không hợp lệ.' });
  }

  const matches = inputString.match(tokenRegex);
  if (!matches || !matches[2]) {
    return res.send({ error: '❌ Không tìm thấy mã gói trong token.' });
  }

  const stringA = matches[2];
  const charMatch = /C(.)%/g.exec(inputString);
  const charExtracted = charMatch ? charMatch[1] : "";
  const newChar = replaceRadio || "C0%";
  let resultString = inputString.replace(/C[56]%/g, newChar);

  if (sourceRadio && sourceRadio !== "Không thay đổi") {
    resultString = resultString.replace(stringA, sourceRadio);
  }

  return res.json({
    result: resultString,
    codeInfo: `✅ Code: ${stringA} - Flag: C${charExtracted}%`
  });
});

app.get('/domains', async (req, res) => {
  try {
    const response = await axios.get(`${SMTP_BASE_URL}/domains?isActive=true`, {
      headers: { 'X-API-KEY': SMTP_API_KEY }
    });

    const domains = response.data?.member?.map(d => d.domain) || [];
    res.json({ domains });
  } catch (error) {
    res.status(500).json({ error: 'Không thể lấy danh sách domain' });
  }
});

app.post('/create-or-use-email', async (req, res) => {
  let { address, domain } = req.body;
  if (!address) {
    domain = domain || 'yamproxy.io.vn';
    address = `${generateRandomUsername()}@${domain}`;
  }
  if (!address.includes('@')) {
    return res.status(400).json({ error: 'Địa chỉ email không hợp lệ' });
  }

  const password = address.split('@')[0];

  try {
    const checkResponse = await axios.get(`${SMTP_BASE_URL}/accounts`, {
      params: { address, isActive: true, page: 1 },
      headers: { 'X-API-KEY': SMTP_API_KEY }
    });

    let accountData;
    const { totalItems, member } = checkResponse.data;

    if (totalItems > 0) {
      accountData = member[0];
    } else {
      const createResponse = await axios.post(`${SMTP_BASE_URL}/accounts`, {
        address, password
      }, {
        headers: {
          'X-API-KEY': SMTP_API_KEY,
          'Content-Type': 'application/json'
        }
      });
      accountData = createResponse.data;
    }

    const inboxMailbox = accountData.mailboxes.find(mb => mb.path === 'INBOX');
    const inboxUrl = inboxMailbox
      ? `/list-messages?accountId=${accountData.id}&mailboxId=${inboxMailbox.id}&page=1`
      : null;

    res.json({
      message: totalItems > 0 ? 'Email đã tồn tại' : 'Tạo email thành công',
      email: accountData.address,
      data: {
        address: encrypt(accountData.address),
        id: accountData.id,
        password
      },
      inboxUrl
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: 'Tạo email thất bại' });
  }
});

app.get('/list-messages', async (req, res) => {
  const { accountId, mailboxId, page } = req.query;
  if (!accountId || !mailboxId) return res.status(400).json({ error: 'Thiếu thông tin hộp thư' });

  try {
    const response = await axios.get(
      `${SMTP_BASE_URL}/accounts/${accountId}/mailboxes/${mailboxId}/messages?page=${page || 1}`,
      {
        headers: { 'X-API-KEY': SMTP_API_KEY }
      }
    );
    res.status(200).json({ data: response.data });
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: 'Lỗi lấy danh sách thư' });
  }
});

// Lấy mã 2FA từ 1 hoặc nhiều secret và tính thời gian còn lại
app.get('/get2fa', (req, res) => {
  res.render('get2fa', { secrets: '', results: [], error: null, timeLeft: null });
});

app.post('/get-tokens', async (req, res) => {
  const { secrets } = req.body;
  if (!secrets) {
    return res.render('get2fa', { secrets: '', results: [], error: '❌ Thiếu secret', timeLeft: null });
  }

  const now = Math.floor(Date.now() / 1000);
  const timeRemaining = 30 - (now % 30);
  const secretList = secrets.split('\n').map(s => s.trim()).filter(Boolean);
  const results = [];

  try {
    // Dùng axios thay vì dynamic import node-fetch để tránh lỗi trên Render
    const axios = require('axios');
    const promises = secretList.map(async secret => {
      const url = `https://2fa.live/tok/${encodeURIComponent(secret)}`;
      const resp = await axios.get(url, { timeout: 5000 });
      const data = resp.data;
      return { secret, token: data.token };
    });
    const apiResults = await Promise.all(promises);
    apiResults.forEach(item => {
      results.push({ secret: item.secret, tokens: [{ token: item.token, timeOffset: 0 }] });
    });
    res.render('get2fa', { secrets, results, error: null, timeLeft: timeRemaining });
  } catch (err) {
    res.render('get2fa', { secrets, results: [], error: 'Lỗi gọi API 2fa.live', timeLeft: null });
  }
});

// API lấy chi tiết thư
app.get('/message-detail', async (req, res) => {
  const { accountId, mailboxId, messageId } = req.query;
  if (!accountId || !mailboxId || !messageId) return res.status(400).json({ error: 'Thiếu thông tin' });
  try {
    const response = await axios.get(
      `${SMTP_BASE_URL}/accounts/${accountId}/mailboxes/${mailboxId}/messages/${messageId}`,
      { headers: { 'X-API-KEY': SMTP_API_KEY } }
    );
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: 'Không lấy được chi tiết thư' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});