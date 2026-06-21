// Hergent Desktop — Feishu Bot API
const https = require("https");

function getFeishuToken(appId, appSecret) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ app_id: appId, app_secret: appSecret });
    const options = {
      hostname: 'open.feishu.cn',
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 0) resolve(json.tenant_access_token);
          else reject(new Error(`飞书API错误: ${json.code} ${json.msg}`));
        } catch { reject(new Error(`解析响应失败: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendFeishuBotMessage(token, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      receive_id: 'all',
      msg_type: 'text',
      content: JSON.stringify({ text }),
    });
    const options = {
      hostname: 'open.feishu.cn',
      path: '/open-apis/im/v1/messages?receive_id_type=open_id',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 0) resolve(json);
          else reject(new Error(`发送消息失败: ${json.code} ${json.msg}`));
        } catch { reject(new Error(`解析响应失败: ${data}`)); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { getFeishuToken, sendFeishuBotMessage };
