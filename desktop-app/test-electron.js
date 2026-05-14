const { app, BrowserWindow, ipcMain } = require('electron');
console.log('ipcMain type:', typeof ipcMain);
console.log('app type:', typeof app);
app.whenReady().then(() => {
  console.log('App ready!');
  app.quit();
});
