# Hergent 代码签名指南

## macOS (Apple Developer $99/年)

package.json 添加:
```json
"notarize": {
  "teamId": "YOUR_TEAM_ID",
  "appleId": "admin@hergent.cn",
  "appSpecificPassword": "@keychain:HergentNotarization"
}
```

## Windows (EV Code Signing ~$300/年)

package.json 添加:
```json
"win": {
  "publisherName": "Xiaohezhiti Technology (Nanjing) Co., Ltd.",
  "certificateFile": "build/hergent-ev-cert.pfx",
  "certificatePassword": "%HERGENT_CERT_PASSWORD%"
}
```

## 当前状态
- hardenedRuntime: true (macOS)
- gatekeeperAssess: true (macOS)
- entitlements: build/entitlements.mac.plist (已创建)
- 代码签名: 等待 Apple Developer 账号
- Windows 签名: 等待 EV 证书
