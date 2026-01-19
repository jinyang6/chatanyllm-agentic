import { contextBridge, ipcRenderer } from 'electron'
import os from 'os'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File system operations
  fs: {
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    readFileBase64: (filePath) => ipcRenderer.invoke('fs:readFileBase64', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    writeBinaryFile: (filePath, base64Data) => ipcRenderer.invoke('fs:writeBinaryFile', filePath, base64Data),
    deleteFile: (filePath) => ipcRenderer.invoke('fs:deleteFile', filePath),
    readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
    exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
    mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath)
  },

  // Dialog operations
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory')
  },

  // Secure storage
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
    clear: () => ipcRenderer.invoke('store:clear'),
    isEncryptionAvailable: () => ipcRenderer.invoke('store:isEncryptionAvailable')
  },

  // Shell operations
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    revealInFileExplorer: (filePath) => ipcRenderer.invoke('shell:revealInFileExplorer', filePath)
  },

  // Workspace operations
  workspace: {
    ensureDirectory: (conversationId) => ipcRenderer.invoke('workspace:ensureDirectory', conversationId),
    deleteDirectory: (workspacePath) => ipcRenderer.invoke('workspace:deleteDirectory', workspacePath)
  },

  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    setTitle: (title) => ipcRenderer.invoke('window:setTitle', title),
    onStateChange: (callback) => {
      const subscription = (event, isMaximized) => callback(isMaximized)
      ipcRenderer.on('window-state-changed', subscription)
      // Return cleanup function
      return () => ipcRenderer.removeListener('window-state-changed', subscription)
    }
  },

  // App info
  getAppDataPath: () => ipcRenderer.invoke('get-app-data-path'),

  // App lifecycle
  signalReady: () => ipcRenderer.invoke('app:ready'),

  // Platform info
  platform: process.platform,
  isElectron: true,

  // OS version detection for conditional UI rendering
  isWindows11: () => {
    if (process.platform !== 'win32') return false
    const buildNumber = parseInt(os.release().split('.')[2] || '0')
    return buildNumber >= 22000
  },

  // OpenCode SDK operations
  opencode: {
    createSession: (conversationId, workingDirectory) =>
      ipcRenderer.invoke('opencode:createSession', conversationId, workingDirectory),

    sendMessage: (conversationId, messageParts, providerId, modelId) =>
      ipcRenderer.invoke('opencode:sendMessage', { conversationId, messageParts, providerId, modelId }),

    abortSession: (conversationId) =>
      ipcRenderer.invoke('opencode:abortSession', conversationId),

    deleteSession: (conversationId) =>
      ipcRenderer.invoke('opencode:deleteSession', conversationId),

    getSessionStatus: (conversationId) =>
      ipcRenderer.invoke('opencode:getSessionStatus', conversationId),

    respondPermission: (requestID, reply, directory, message) =>
      ipcRenderer.invoke('opencode:respondPermission', { requestID, reply, directory, message }),

    onEvent: (callback) => {
      const subscription = (event, data) => callback(data)
      ipcRenderer.on('opencode:event', subscription)
      // Return cleanup function
      return () => ipcRenderer.removeListener('opencode:event', subscription)
    },

    // Update management
    getVersion: () => ipcRenderer.invoke('opencode:getVersion'),
    getAvailableVersions: () => ipcRenderer.invoke('opencode:getAvailableVersions'),
    checkUpdates: () => ipcRenderer.invoke('opencode:checkUpdates'),
    update: (targetVersion) => ipcRenderer.invoke('opencode:update', targetVersion),
    onUpdateProgress: (callback) => {
      const subscription = (event, data) => callback(data)
      ipcRenderer.on('opencode:updateProgress', subscription)
      return () => ipcRenderer.removeListener('opencode:updateProgress', subscription)
    }
  }
})

console.log('Electron preload script loaded')
