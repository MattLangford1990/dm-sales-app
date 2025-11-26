# DM Sales App - Native Build Guide

This guide explains how to build the DM Sales app as a native iOS or Android app.

## Prerequisites

### For iOS
- macOS (required)
- Xcode 14+ (from App Store)
- Xcode Command Line Tools: `xcode-select --install`
- CocoaPods: `sudo gem install cocoapods`
- Apple Developer Account (for device testing/distribution)

### For Android
- Android Studio (https://developer.android.com/studio)
- Java JDK 17+
- Android SDK (installed via Android Studio)

## Initial Setup

1. **Install dependencies:**
   ```bash
   cd frontend
   npm install
   ```

2. **Build the web app:**
   ```bash
   npm run build
   ```

3. **Add native platforms:**
   ```bash
   # For iOS
   npm run cap:add:ios
   
   # For Android
   npm run cap:add:android
   ```

## Building for iOS

1. **Sync the web build to iOS:**
   ```bash
   npm run build:ios
   ```

2. **Open in Xcode:**
   ```bash
   npm run cap:open:ios
   ```

3. **In Xcode:**
   - Select your development team in Signing & Capabilities
   - Select a target device (simulator or connected device)
   - Press Play to run

4. **To create an IPA for distribution:**
   - Product → Archive
   - Distribute App → Ad Hoc or App Store Connect

## Building for Android

1. **Sync the web build to Android:**
   ```bash
   npm run build:android
   ```

2. **Open in Android Studio:**
   ```bash
   npm run cap:open:android
   ```

3. **In Android Studio:**
   - Wait for Gradle sync to complete
   - Select a device/emulator
   - Press Run

4. **To create an APK:**
   - Build → Build Bundle(s) / APK(s) → Build APK(s)
   - APK will be in `android/app/build/outputs/apk/debug/`

## App Icons

Place your app icons in:
- **iOS:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
- **Android:** `android/app/src/main/res/mipmap-*/`

Use a tool like https://appicon.co to generate all required sizes.

## Splash Screen

Configure in `capacitor.config.json`:
```json
{
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 2000,
      "backgroundColor": "#1e40af"
    }
  }
}
```

## Offline Functionality

The app works fully offline after initial setup:

1. **First use (online required):**
   - Login with Agent ID and PIN
   - Go to Settings → Download Data for Offline Use

2. **Subsequent use (works offline):**
   - Login works offline (credentials stored locally)
   - Browse products from cached data
   - View customers from cached data
   - Create orders (saved locally, submitted when back online)
   - Scan barcodes (using local product database)

## API Configuration

By default, the app connects to the Render-hosted backend. To change this:

1. Edit `frontend/src/App.jsx`:
   ```javascript
   const API_BASE = 'https://your-api-url.com/api'
   ```

2. Or for local development, keep the proxy in `vite.config.js`:
   ```javascript
   proxy: {
     '/api': {
       target: 'http://localhost:8000',
       changeOrigin: true
     }
   }
   ```

## Updating the App

After making changes to the web code:

```bash
# Rebuild and sync
npm run build:native

# Or for a specific platform
npm run build:ios
npm run build:android
```

## Troubleshooting

### iOS: "No provisioning profile"
- In Xcode, go to Signing & Capabilities and select your team

### Android: Gradle sync failed
- File → Invalidate Caches → Invalidate and Restart
- Or update Gradle version in `android/gradle/wrapper/gradle-wrapper.properties`

### App shows blank screen
- Check browser console in Safari (iOS) or Chrome (Android) dev tools
- Ensure `npm run build` completed successfully

### Offline login not working
- Must login online at least once first
- Check IndexedDB storage isn't cleared
