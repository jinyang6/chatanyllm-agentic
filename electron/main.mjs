// Electron main process
// Note: This file uses ES modules (.mjs) for compatibility with @opencode-ai/sdk

import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs from 'fs/promises'
import os from 'os'

// ES module polyfills for __dirname and __filename
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// OpenCode SDK integration
import { createOpencodeClient } from '@opencode-ai/sdk'
import { spawn } from 'child_process'
let opencodeClient = null
let opencodeServer = null
const opencodeSessions = new Map() // conversationId → { sessionId, eventStream }
const permissionToSession = new Map() // permissionID → sessionId

// Import Electron modules
// When running in Electron context, these should be available
let app, BrowserWindow, ipcMain, dialog, shell, safeStorage

try {
  const electron = await import('electron')

  // Check if we got the actual Electron API or just a path string
  if (typeof electron === 'string') {
    console.error('ERROR: Electron API not available in current context')
    console.error('This usually means Electron is not running correctly')
    console.error('Try: npx electron . or npm run app')
    process.exit(1)
  }

  ({ app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = electron.default || electron)

  if (!app || !BrowserWindow) {
    console.error('ERROR: Electron modules not properly loaded')
    process.exit(1)
  }

  console.log('✓ Electron main process initialized successfully')
} catch (error) {
  console.error('ERROR: Failed to load Electron:', error.message)
  process.exit(1)
}

// More reliable dev detection - check if running from source or packaged
const isDev = !app.isPackaged

let mainWindow = null
let showWindowTimeout = null

// Detect Windows version for smart titlebar configuration
function isWindows11() {
  if (process.platform !== 'win32') return false

  const osRelease = os.release()
  const buildNumber = parseInt(osRelease.split('.')[2] || '0')

  // Windows 11 starts at build 22000
  return buildNumber >= 22000
}

function createWindow() {
  // Base window configuration
  const windowConfig = {
    width: 1200,
    height: 800,
    minWidth: 950,
    minHeight: 600,
    show: false,  // Don't show until app is ready (prevents blank screen)
    backgroundColor: '#F9F9F9',  // Match app background
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,  // Disable CORS for custom API providers
      enableBlinkFeatures: 'OverlayScrollbars',  // Better scrollbar performance
      // VS Code performance optimizations
      v8CacheOptions: isDev ? 'none' : 'bypassHeatCheck',  // Code caching for faster startup
      spellcheck: false  // Disable spellcheck for better performance
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, isDev ? '../public/icon.ico' : '../dist/icon.ico')
  }

  // Platform-specific titlebar configuration
  if (process.platform === 'win32') {
    // Windows: Always use custom titlebar for better control and performance
    // This approach is used by VS Code and provides consistent experience
    windowConfig.frame = false
    windowConfig.titleBarStyle = 'hidden'

    // Windows-specific optimizations for smoother resize animations
    windowConfig.transparent = false  // Opaque windows perform better
    windowConfig.hasShadow = true  // Native shadow for better integration

    if (isWindows11()) {
      console.log('✓ Windows 11 detected - using optimized custom titlebar')
    } else {
      console.log('✓ Windows 10 detected - using custom titlebar')
    }
  } else if (process.platform === 'darwin') {
    // macOS: Native traffic lights with hidden titlebar
    windowConfig.titleBarStyle = 'hiddenInset'
    windowConfig.trafficLightPosition = { x: 10, y: 10 }
    console.log('✓ macOS detected - using native traffic lights')
  } else {
    // Linux: Custom titlebar
    windowConfig.frame = false
    console.log('✓ Linux detected - using custom titlebar')
  }

  mainWindow = new BrowserWindow(windowConfig)

  // Disable the resize overlay that shows window dimensions
  if (process.platform === 'win32') {
    try {
      mainWindow.setAutoHideMenuBar(true)
      mainWindow.setMenuBarVisibility(false)
    } catch (e) {
      console.warn('Could not hide menu bar:', e.message)
    }
  }

  // Show window when renderer signals it's ready, or after timeout as fallback
  showWindowTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      console.log('Window shown after timeout fallback')
    }
  }, 3000)

  // Load app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3005')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in default browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' } // Prevent opening in Electron
  })

  // Handle navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentURL = mainWindow.webContents.getURL()
    // Allow navigation within the app (localhost in dev, file:// in prod)
    if (isDev && url.startsWith('http://localhost')) {
      return // Allow internal navigation
    }
    if (!isDev && url.startsWith('file://')) {
      return // Allow internal navigation
    }
    // External URL - open in default browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // Send window state changes to renderer for custom titlebar sync
  mainWindow.on('maximize', () => {
    if (mainWindow) {
      mainWindow.webContents.send('window-state-changed', true)
    }
  })

  mainWindow.on('unmaximize', () => {
    if (mainWindow) {
      mainWindow.webContents.send('window-state-changed', false)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ===== OpenCode SDK Functions =====

// Ensure workspace directory exists for a conversation
async function ensureWorkspaceDirectory(conversationId) {
  const workspacePath = path.join(
    app.getPath('userData'),
    'userfiles',
    'workspaces',
    conversationId
  )

  // Create directory if doesn't exist
  await fs.mkdir(workspacePath, { recursive: true })

  // Create a README to explain what this folder is
  const readmePath = path.join(workspacePath, 'README.md')

  try {
    await fs.access(readmePath)
    // README exists, don't overwrite
  } catch {
    // README doesn't exist, create it
    await fs.writeFile(readmePath,
      '# Safe Workspace\n\n' +
      'This folder is a safe workspace for your conversation.\n' +
      'Files created by OpenCode will be stored here.\n\n' +
      'You can link this conversation to a real project folder using the "Link to Folder" button.\n'
    )
  }

  return workspacePath
}

// Delete workspace directory recursively
async function deleteWorkspaceDirectory(workspacePath) {
  try {
    // Safety check: only delete if path is within userfiles/workspaces
    const userDataPath = app.getPath('userData')
    const workspacesBasePath = path.join(userDataPath, 'userfiles', 'workspaces')

    // Normalize paths for comparison
    const normalizedWorkspace = path.normalize(workspacePath)
    const normalizedBase = path.normalize(workspacesBasePath)

    // Ensure workspace path is actually inside workspaces directory
    if (!normalizedWorkspace.startsWith(normalizedBase)) {
      console.error('❌ Attempted to delete directory outside of workspaces:', workspacePath)
      throw new Error('Cannot delete directory outside of workspace folder')
    }

    // Delete directory recursively
    await fs.rm(workspacePath, { recursive: true, force: true })
    console.log('✓ Deleted workspace directory:', workspacePath)

    return true
  } catch (error) {
    console.error('Failed to delete workspace directory:', error)
    throw error
  }
}

// Custom function to start OpenCode server
async function startOpencodeServer(options = {}) {
  const hostname = options.hostname || '127.0.0.1'
  const port = options.port || 4096
  const timeout = options.timeout || 5000

  // Use the node wrapper script directly on Windows
  const opencodeBinary = process.platform === 'win32'
    ? path.join(process.cwd(), 'node_modules', 'opencode-ai', 'bin', 'opencode.cmd')
    : path.join(process.cwd(), 'node_modules', 'opencode-ai', 'bin', 'opencode')

  console.log('🔵 Using OpenCode binary:', opencodeBinary)

  const args = ['serve', `--hostname=${hostname}`, `--port=${port}`]

  // Spawn the server process
  const proc = spawn(opencodeBinary, args, {
    shell: true, // Important for Windows .cmd files
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config || {})
    }
  })

  // Wait for server to start
  const url = await new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`Timeout waiting for server to start after ${timeout}ms`))
    }, timeout)

    let output = ''
    proc.stdout?.on('data', (chunk) => {
      output += chunk.toString()
      console.log('OpenCode stdout:', chunk.toString())
      const lines = output.split('\n')
      for (const line of lines) {
        if (line.includes('opencode server listening')) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (match) {
            clearTimeout(id)
            resolve(match[1])
            return
          }
        }
      }
    })

    proc.stderr?.on('data', (chunk) => {
      output += chunk.toString()
      console.error('OpenCode stderr:', chunk.toString())
    })

    proc.on('exit', (code) => {
      clearTimeout(id)
      reject(new Error(`Server exited with code ${code}\nOutput: ${output}`))
    })

    proc.on('error', (error) => {
      clearTimeout(id)
      reject(error)
    })
  })

  return {
    url,
    process: proc,
    close() {
      proc.kill()
    }
  }
}

// Kill any existing OpenCode processes (cleanup from previous crashes)
async function killExistingOpenCodeProcesses() {
  try {
    console.log('🔵 Checking for existing OpenCode processes...')

    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    if (process.platform === 'win32') {
      // Windows: Kill by process name AND by port

      // Method 1: Try to kill by process name
      try {
        await execAsync('taskkill /F /IM opencode.exe 2>&1')
        console.log('✓ Killed existing OpenCode processes by name')
      } catch (error) {
        // No processes found - this is okay
      }

      // Method 2: Kill by port (more reliable for zombies)
      console.log('🔵 Checking ports for zombie processes...')
      for (const port of [4096, 4097, 4098, 4099]) {
        try {
          const netstatResult = await execAsync(`netstat -ano | findstr ":${port}"`)
          const lines = netstatResult.stdout.split('\n')
          console.log(`🔵 Port ${port} netstat result:`, lines.length, 'lines')

          for (const line of lines) {
            if (line.includes('LISTENING')) {
              const parts = line.trim().split(/\s+/)
              const pid = parts[parts.length - 1]
              console.log(`🔵 Found process ${pid} on port ${port}`)

              if (pid && pid !== '0' && !isNaN(pid)) {
                try {
                  // Use /F instead of //F to avoid escaping issues
                  await execAsync(`taskkill /F /PID ${pid}`)
                  console.log(`✓ Killed process ${pid} occupying port ${port}`)
                } catch (killError) {
                  console.log(`⚠ Could not kill PID ${pid}:`, killError.message)
                }
              }
            }
          }
        } catch (netstatError) {
          // Port not in use - this is fine
          console.log(`✓ Port ${port} is free`)
        }
      }

      // Wait for ports to be released
      await new Promise(resolve => setTimeout(resolve, 2000))
      console.log('✓ Waited for port release')
    } else {
      // Unix: Use pkill

      try {
        await execAsync('pkill -9 opencode')
        console.log('✓ Killed existing OpenCode processes')
        // Wait a bit for processes to fully terminate
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error) {
        if (error.code === 1) {
          console.log('✓ No existing OpenCode processes to clean up')
        } else {
          console.warn('Warning killing processes:', error.message)
        }
      }
    }
  } catch (error) {
    console.error('Failed to kill existing OpenCode processes:', error)
  }
}

// Initialize OpenCode server and client
async function initializeOpenCode() {
  try {
    console.log('🔵 Starting OpenCode initialization...')
    console.log('🔵 Working directory:', process.cwd())

    // Kill any zombie processes first
    await killExistingOpenCodeProcesses()

    // Try to start server, retrying with different ports if needed
    let server = null
    let lastError = null
    const ports = [4096, 4097, 4098, 4099]

    for (const port of ports) {
      try {
        console.log(`🔵 Attempting to start OpenCode server on port ${port}...`)
        server = await startOpencodeServer({
          hostname: '127.0.0.1',
          port: port,
          timeout: 10000
        })
        console.log(`✅ OpenCode server started successfully on port ${port}`)
        break
      } catch (error) {
        console.log(`❌ Failed to start on port ${port}:`, error.message)
        lastError = error
        // Continue to next port
      }
    }

    if (!server) {
      throw lastError || new Error('Failed to start OpenCode server on any port')
    }

    opencodeServer = server

    // Create client to connect to the server
    opencodeClient = createOpencodeClient({
      baseUrl: server.url
    })

    console.log('✅✅✅ OpenCode server and client initialized ✅✅✅')
    console.log(`✅ OpenCode server running (PID: ${opencodeServer?.pid || 'N/A'})`)
    console.log('🔵 Server object:', opencodeServer ? 'exists' : 'null')
    console.log('🔵 Client object:', opencodeClient ? 'exists' : 'null')
    return true
  } catch (error) {
    console.error('❌❌❌ Failed to initialize OpenCode ❌❌❌')
    console.error('Error:', error)
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    return false
  }
}

// Process OpenCode event stream
async function processEventStream(conversationId, sessionId, eventStream) {
  try {
    console.log(`🔵 Started event stream processing for session ${sessionId}`)
    for await (const event of eventStream.stream) {
      console.log(`🔵 OpenCode event received:`, event.type, event)

      // Track permission to session mapping
      if (event.type === 'permission.asked' && event.properties?.id) {
        permissionToSession.set(event.properties.id, sessionId)
        console.log(`🔵 Mapped permission ${event.properties.id} to session ${sessionId}`)
      }

      // Forward events to renderer process
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('opencode:event', {
          conversationId,
          sessionId,
          event
        })
      }
    }
    console.log(`🔵 Event stream ended for session ${sessionId}`)
  } catch (error) {
    console.error('Event stream error:', error)
    // Notify renderer of stream error
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('opencode:event', {
        conversationId,
        sessionId,
        event: {
          type: 'error',
          properties: { error: error.message }
        }
      })
    }
  }
}

// Apply VS Code performance optimizations
// Disable native window occlusion tracker for better animation performance
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// Additional performance optimizations for smoother animations
if (process.platform === 'win32') {
  // Enable hardware acceleration features
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder')
  // Improve GPU performance
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
}

app.whenReady().then(() => {
  // Set app icon for Windows taskbar
  if (process.platform === 'win32') {
    const iconPath = isDev
      ? path.join(__dirname, '../public/icon.ico')
      : path.join(__dirname, '../dist/icon.ico')
    app.setAppUserModelId('com.chatanyllm.app')
    console.log('App icon path:', iconPath)
  }

  createWindow()

  // Initialize OpenCode SDK (await to ensure cleanup completes before starting)
  initializeOpenCode().catch(err => {
    console.error('Failed to initialize OpenCode:', err)
    // App continues to work, just without OpenCode
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Cleanup function for OpenCode
async function cleanupOpenCode() {
  console.log('🔵 Cleaning up OpenCode...')

  // Clean up sessions
  if (opencodeClient && opencodeSessions.size > 0) {
    console.log('Cleaning up OpenCode sessions...')
    for (const [conversationId, sessionData] of opencodeSessions.entries()) {
      try {
        // Delete session
        await opencodeClient.session.delete({
          path: { id: sessionData.sessionId }
        })
      } catch (error) {
        console.error(`Failed to cleanup session ${sessionData.sessionId}:`, error)
      }
    }
    opencodeSessions.clear()
    console.log('✓ OpenCode sessions cleaned up')
  }

  // Stop OpenCode server process
  if (opencodeServer) {
    try {
      console.log('Stopping OpenCode server...')
      if (opencodeServer.process) {
        // Kill the process forcefully
        opencodeServer.process.kill('SIGTERM')

        // If it doesn't die after 2 seconds, force kill
        setTimeout(() => {
          if (opencodeServer.process && !opencodeServer.process.killed) {
            console.log('Force killing OpenCode server...')
            opencodeServer.process.kill('SIGKILL')
          }
        }, 2000)
      }
      if (opencodeServer.close) {
        opencodeServer.close()
      }
      console.log('✓ OpenCode server stopped')
    } catch (error) {
      console.error('Failed to stop OpenCode server:', error)
    }
  }
}

// Cleanup OpenCode sessions and server on app quit
app.on('before-quit', async () => {
  await cleanupOpenCode()
})

// Also cleanup when window is closed (belt and suspenders)
app.on('window-all-closed', async () => {
  await cleanupOpenCode()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ===== IPC Handlers for File System Operations =====

// Get app data path for storing conversations
ipcMain.handle('get-app-data-path', () => {
  return app.getPath('userData')
})

// Read file
ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Write file with atomic operation (temp file + rename)
ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    // Use temp file + rename for atomic writes
    // This prevents partial writes from corrupting files
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}`
    await fs.writeFile(tempPath, content, 'utf-8')

    // Rename is atomic on most filesystems
    await fs.rename(tempPath, filePath)

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Delete file
ipcMain.handle('fs:deleteFile', async (event, filePath) => {
  console.log('IPC fs:deleteFile called with path:', filePath)
  try {
    await fs.unlink(filePath)
    console.log('File deleted successfully:', filePath)
    return { success: true }
  } catch (error) {
    console.error('File deletion error:', error.message)
    return { success: false, error: error.message }
  }
})

// List files in directory
ipcMain.handle('fs:readDir', async (event, dirPath) => {
  try {
    const files = await fs.readdir(dirPath)
    return { success: true, files }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Check if file exists
ipcMain.handle('fs:exists', async (event, filePath) => {
  try {
    await fs.access(filePath)
    return { success: true, exists: true }
  } catch (error) {
    return { success: true, exists: false }
  }
})

// Create directory
ipcMain.handle('fs:mkdir', async (event, dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Write binary file (for images, etc.)
ipcMain.handle('fs:writeBinaryFile', async (event, filePath, base64Data) => {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    // Remove data URL prefix if present (data:image/png;base64,...)
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '')

    // Convert base64 to buffer
    const buffer = Buffer.from(cleanBase64, 'base64')

    // Use temp file + rename for atomic writes
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}`
    await fs.writeFile(tempPath, buffer)

    // Rename is atomic on most filesystems
    await fs.rename(tempPath, filePath)

    return { success: true, path: filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Show open dialog
ipcMain.handle('dialog:openFile', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, options)
    return { success: true, ...result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Show save dialog
ipcMain.handle('dialog:saveFile', async (event, options) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, options)
    return { success: true, ...result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Show directory selection dialog
ipcMain.handle('dialog:selectDirectory', async (event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Working Directory',
      buttonLabel: 'Select Folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true, filePath: null }
    }

    return { success: true, canceled: false, filePath: result.filePaths[0] }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Ensure workspace directory exists
ipcMain.handle('workspace:ensureDirectory', async (event, conversationId) => {
  try {
    const workspacePath = await ensureWorkspaceDirectory(conversationId)
    return { success: true, path: workspacePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Delete workspace directory
ipcMain.handle('workspace:deleteDirectory', async (event, workspacePath) => {
  try {
    await deleteWorkspaceDirectory(workspacePath)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Reveal directory in file explorer
ipcMain.handle('shell:revealInFileExplorer', async (event, filePath) => {
  try {
    await shell.showItemInFolder(filePath)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ===== Secure Storage for API Keys =====
// Using Electron's safeStorage API with Windows DPAPI encryption
// API keys are encrypted before being written to disk

// Write queue to prevent race conditions when multiple store operations happen simultaneously
let storeWriteQueue = Promise.resolve()

// Encryption helper functions
function encryptData(plainText) {
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('DPAPI encryption not available on Windows')
    return null
  }
  try {
    const buffer = safeStorage.encryptString(plainText)
    return buffer.toString('base64')
  } catch (error) {
    console.error('Encryption failed:', error)
    return null
  }
}

function decryptData(encryptedBase64) {
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    const buffer = Buffer.from(encryptedBase64, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    console.error('Decryption failed:', error)
    return null
  }
}

// Check if data is already encrypted
function isEncrypted(data) {
  return typeof data === 'object' && data !== null && data._encrypted === true
}

ipcMain.handle('store:get', async (event, key) => {
  try {
    const storePath = path.join(app.getPath('userData'), 'store.json')

    try {
      const data = await fs.readFile(storePath, 'utf-8')
      const store = JSON.parse(data)
      const value = store[key]

      // Check if this is encrypted data
      if (key === 'apiKeys' && isEncrypted(value)) {
        const decryptedJson = decryptData(value._data)
        if (decryptedJson) {
          return { success: true, value: JSON.parse(decryptedJson) }
        } else {
          return { success: false, error: 'Decryption failed' }
        }
      }

      // Check if we need to migrate old plain-text API keys
      if (key === 'apiKeys' && value && !isEncrypted(value)) {
        console.log('🔄 Migrating plain-text API keys to encrypted storage...')

        // Queue the migration write operation to prevent race conditions
        await new Promise((resolve) => {
          storeWriteQueue = storeWriteQueue
            .then(async () => {
              try {
                // Re-read to ensure we have latest data
                const freshData = await fs.readFile(storePath, 'utf-8')
                const freshStore = JSON.parse(freshData)

                // Encrypt and save the data
                const encryptedData = encryptData(JSON.stringify(value))
                if (encryptedData) {
                  freshStore[key] = {
                    _encrypted: true,
                    _version: 1,
                    _data: encryptedData
                  }
                  await fs.writeFile(storePath, JSON.stringify(freshStore, null, 2), 'utf-8')
                  console.log('✓ Migration complete - API keys now encrypted')
                } else {
                  console.error('✗ Migration failed - encryption not available')
                }
                resolve()
              } catch (error) {
                console.error('Migration error:', error)
                resolve()
              }
            })
            .catch(() => resolve())
        })
      }

      return { success: true, value }
    } catch (error) {
      // File doesn't exist or is empty
      return { success: true, value: null }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('store:set', async (event, key, value) => {
  // Queue this operation to prevent race conditions
  // Each operation waits for the previous one to complete
  const result = await new Promise((resolve) => {
    storeWriteQueue = storeWriteQueue
      .then(async () => {
        try {
          const storePath = path.join(app.getPath('userData'), 'store.json')

          let store = {}
          try {
            const data = await fs.readFile(storePath, 'utf-8')
            store = JSON.parse(data)
          } catch (error) {
            // File doesn't exist, start with empty store
          }

          // Encrypt API keys before storing
          if (key === 'apiKeys') {
            const encryptedData = encryptData(JSON.stringify(value))
            if (encryptedData) {
              store[key] = {
                _encrypted: true,
                _version: 1,
                _data: encryptedData
              }
            } else {
              resolve({ success: false, error: 'Encryption failed - DPAPI not available' })
              return
            }
          } else {
            // Non-sensitive data stored as-is
            store[key] = value
          }

          await fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8')

          // Set file permissions to owner-only (Windows)
          try {
            await fs.chmod(storePath, 0o600)
          } catch (chmodError) {
            console.warn('Could not set file permissions:', chmodError.message)
          }

          resolve({ success: true })
        } catch (error) {
          resolve({ success: false, error: error.message })
        }
      })
      .catch((error) => {
        // Handle any unexpected errors in the queue
        resolve({ success: false, error: error.message })
      })
  })

  return result
})

ipcMain.handle('store:delete', async (event, key) => {
  try {
    const storePath = path.join(app.getPath('userData'), 'store.json')

    let store = {}
    try {
      const data = await fs.readFile(storePath, 'utf-8')
      store = JSON.parse(data)
    } catch (error) {
      return { success: true } // Already doesn't exist
    }

    delete store[key]
    await fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8')

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('store:clear', async () => {
  try {
    const storePath = path.join(app.getPath('userData'), 'store.json')
    await fs.writeFile(storePath, '{}', 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Check if encryption is available
ipcMain.handle('store:isEncryptionAvailable', () => {
  return {
    success: true,
    available: safeStorage.isEncryptionAvailable(),
    platform: process.platform
  }
})

// ===== Open External Links =====
ipcMain.handle('shell:openExternal', async (event, url) => {
  try {
    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ===== Window Controls for Custom Title Bar =====
ipcMain.handle('window:minimize', () => {
  if (mainWindow) {
    mainWindow.minimize()
  }
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.handle('window:close', () => {
  if (mainWindow) {
    mainWindow.close()
  }
})

ipcMain.handle('window:isMaximized', () => {
  if (mainWindow) {
    return mainWindow.isMaximized()
  }
  return false
})

// App ready signal from renderer - show window when React app is fully loaded
ipcMain.handle('app:ready', () => {
  if (showWindowTimeout) {
    clearTimeout(showWindowTimeout)
    showWindowTimeout = null
  }
  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show()
    console.log('Window shown after app:ready signal')
  }
})

// ===== OpenCode IPC Handlers =====

// Create OpenCode session for a conversation
ipcMain.handle('opencode:createSession', async (event, conversationId, workingDirectory) => {
  if (!opencodeClient) {
    return { success: false, error: 'OpenCode client not initialized' }
  }

  try {
    console.log(`🔵 Creating OpenCode session for ${conversationId}`)

    // Create session - OpenCode will use the server's starting directory
    const sessionResponse = await opencodeClient.session.create({
      body: { title: `Chat ${conversationId.substring(0, 8)}` }
    })

    console.log('🔵 Session create response:', JSON.stringify(sessionResponse, null, 2))

    // Extract session ID from response
    const sessionId = sessionResponse.data?.id || sessionResponse.id || sessionResponse.data?.sessionID || sessionResponse.sessionID
    const sessionDirectory = sessionResponse.data?.directory || workingDirectory

    if (!sessionId) {
      console.error('❌ No session ID in response:', sessionResponse)
      return { success: false, error: 'Failed to get session ID from response' }
    }

    console.log(`✓ OpenCode session created: ${sessionId}`)
    console.log(`✓ Session working directory: ${sessionDirectory}`)

    // Start event stream for this session
    const eventStream = await opencodeClient.event.subscribe()

    // Store session info
    opencodeSessions.set(conversationId, {
      sessionId: sessionId,
      eventStream: eventStream
    })

    // Process events in background
    processEventStream(conversationId, sessionId, eventStream)

    console.log(`✓ OpenCode session created for conversation ${conversationId}: ${sessionId}`)
    return { success: true, sessionId: sessionId, directory: sessionDirectory }
  } catch (error) {
    console.error('Failed to create OpenCode session:', error)
    return { success: false, error: error.message }
  }
})

// Send message to OpenCode session
ipcMain.handle('opencode:sendMessage', async (event, { conversationId, message, providerId, modelId }) => {
  if (!opencodeClient) {
    return { success: false, error: 'OpenCode client not initialized' }
  }

  const sessionData = opencodeSessions.get(conversationId)
  if (!sessionData) {
    return { success: false, error: 'No OpenCode session for this conversation' }
  }

  try {
    // Send prompt to session using the user's selected provider and model
    console.log('🔵 OpenCode sendMessage called with:', {
      conversationId,
      providerId,
      modelId,
      messagePreview: message.substring(0, 50)
    })

    // Use the user's selected provider and model directly
    // OpenCode handles provider routing internally
    const promptBody = {
      model: {
        providerID: providerId,
        modelID: modelId
      },
      parts: [{ type: 'text', text: message }]
    }

    const promptOptions = {
      path: { id: sessionData.sessionId },
      body: promptBody
    }

    console.log('🔵 Sending to OpenCode with options:', JSON.stringify(promptOptions, null, 2))

    const response = await opencodeClient.session.prompt(promptOptions)

    console.log(`✓ Message sent to OpenCode session ${sessionData.sessionId} using ${providerId}/${modelId}`)
    console.log('🔵 OpenCode response:', response)

    // Check if response has error
    if (response.error) {
      console.error('❌ OpenCode returned error:', JSON.stringify(response.error, null, 2))
      return { success: false, error: JSON.stringify(response.error) }
    }

    return { success: true, response }
  } catch (error) {
    console.error('Failed to send OpenCode message:', error)
    return { success: false, error: error.message }
  }
})

// Abort OpenCode session (stop current generation)
ipcMain.handle('opencode:abortSession', async (event, conversationId) => {
  const sessionData = opencodeSessions.get(conversationId)
  if (!sessionData) {
    return { success: true }
  }

  try {
    // Note: OpenCode SDK doesn't have an explicit abort method
    // The session can just be left as-is or deleted
    console.log(`✓ OpenCode session aborted (no-op): ${sessionData.sessionId}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to abort OpenCode session:', error)
    return { success: false, error: error.message }
  }
})

// Delete OpenCode session
ipcMain.handle('opencode:deleteSession', async (event, conversationId) => {
  const sessionData = opencodeSessions.get(conversationId)
  if (!sessionData) {
    return { success: true }
  }

  try {
    // Delete session using correct API
    await opencodeClient.session.delete({
      path: { id: sessionData.sessionId }
    })
    opencodeSessions.delete(conversationId)

    console.log(`✓ OpenCode session deleted: ${sessionData.sessionId}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to delete OpenCode session:', error)
    return { success: false, error: error.message }
  }
})

// Get OpenCode session status
ipcMain.handle('opencode:getSessionStatus', async (event, conversationId) => {
  const sessionData = opencodeSessions.get(conversationId)
  return {
    exists: !!sessionData,
    sessionId: sessionData?.sessionId
  }
})

// Respond to OpenCode permission request
ipcMain.handle('opencode:respondPermission', async (event, { requestID, reply, directory }) => {
  if (!opencodeClient) {
    return { success: false, error: 'OpenCode client not initialized' }
  }

  // Find which session this permission belongs to
  const sessionId = permissionToSession.get(requestID)

  if (!sessionId) {
    console.error('❌ No session found for permission ID:', requestID)
    return { success: false, error: 'No session found for this permission request' }
  }

  try {
    console.log('🔵 Responding to permission:', { sessionId, requestID, reply, directory })

    const response = await opencodeClient.postSessionIdPermissionsPermissionId({
      path: {
        id: sessionId,
        permissionID: requestID
      },
      body: {
        response: reply // "once", "always", or "reject"
      },
      query: directory ? { directory } : undefined
    })

    console.log('✓ Permission response sent:', response)
    return { success: true, response }
  } catch (error) {
    console.error('Failed to respond to permission:', error)
    return { success: false, error: error.message }
  }
})

console.log('Electron main process started')
console.log('App data path:', app.getPath('userData'))
console.log('Dev mode:', isDev)
