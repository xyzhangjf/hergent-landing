// Hergent Desktop — WeCom Bot API
const https = require("https");

function getWecomToken(corpId, corpSecret) {
  return new Promise((resolve, reject) => {
    https.get(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`,
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.errcode === 0) resolve(json.access_token);
            else reject(new Error(`企微API错误: ${json.errcode} ${json.errmsg}`));
          } catch { reject(new Error(`解析响应失败: ${data}`)); }
        });
      }
    ).on('error', reject);
  });
}

module.exports = { getWecomToken };
