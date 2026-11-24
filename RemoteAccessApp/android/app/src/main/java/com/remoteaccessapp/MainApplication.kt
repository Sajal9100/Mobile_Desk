package com.remoteaccessapp

import android.app.Application
import android.content.pm.ApplicationInfo
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.oney.WebRTCModule.WebRTCModuleOptions
import com.remoteaccessapp.spike.SpikeProbePackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())

          // SPIKE-ONLY (Milestone 1, REMOVE at cleanup): native probes for traps T1 and T7.
          // Registered in debuggable builds only.
          if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            add(SpikeProbePackage())
          }
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // KEEP (Milestone 1): react-native-webrtc's foreground service is opt-in and defaults to OFF.
    // With it off, getDisplayMedia() runs with no mediaProjection foreground service and capture
    // fails on Android 10+ targets. When on, the library starts the service itself, AFTER the user
    // grants capture consent, which is the order Android 14+ requires (see docs/SPIKE_FINDINGS.md T1).
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
    loadReactNative(this)
  }
}
