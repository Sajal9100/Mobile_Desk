package com.remoteaccessapp.spike

import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import com.oney.WebRTCModule.MediaProjectionService
import java.util.concurrent.TimeoutException

/**
 * SPIKE-ONLY (Milestone 1). THROWAWAY: REMOVE this whole package at cleanup.
 * Registered only in debuggable builds (see MainApplication). Native probes for:
 *  - T1: what happens if the mediaProjection foreground service is started BEFORE capture consent
 *  - T7: FLAG_SECURE content appears black to the viewer (self-test with this app's own window)
 * Deliberately registered through the same deprecated ReactPackage.createNativeModules path that
 * react-native-webrtc itself uses, so it also exercises the legacy-module interop (T3).
 */
class SpikeProbeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SpikeProbe"

  /**
   * Starts react-native-webrtc's MediaProjectionService without any prior capture consent, the
   * order the brief's reference flow would produce. On Android 10-13 this is expected to work; on
   * Android 14+ a SecurityException in onStartCommand is expected to kill the process, in which
   * case this promise never settles and the crash is the evidence.
   */
  @ReactMethod
  fun startServiceBeforeConsent(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "no current activity")
      return
    }
    val future = MediaProjectionService.launch(activity)
    Handler(Looper.getMainLooper()).postDelayed(
        { future.completeExceptionally(TimeoutException()) },
        6000,
    )
    future.whenComplete { _, error ->
      MediaProjectionService.abort(activity)
      promise.resolve(if (error == null) "started-without-consent" else "failed:${error.javaClass.simpleName}")
    }
  }

  /** Marks this app's window FLAG_SECURE (or clears it), as a banking app would. */
  @ReactMethod
  fun setSecure(enabled: Boolean, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "no current activity")
      return
    }
    activity.runOnUiThread {
      if (enabled) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
      promise.resolve(enabled)
    }
  }
}

@Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
class SpikeProbePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(SpikeProbeModule(reactContext))

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<in Nothing, in Nothing>> = emptyList()
}
