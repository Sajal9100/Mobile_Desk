import React from 'react';
import { View, StyleSheet, Text } from 'react-native';

export type IconName =
  | 'app-logo'
  | 'help-hands'
  | 'home'
  | 'devices'
  | 'sessions'
  | 'settings'
  | 'copy'
  | 'bell'
  | 'close'
  | 'outgoing'
  | 'incoming'
  | 'connect-screen'
  | 'screen-share'
  | 'shield-warn'
  | 'back'
  | 'clock'
  | 'eye'
  | 'eye-off'
  | 'chevron-right'
  | 'phone'
  | 'window'
  | 'bank'
  | 'bell-slash'
  | 'stop-circle'
  | 'zoom'
  | 'fullscreen'
  | 'recents'
  | 'type'
  | 'tap'
  | 'disconnect'
  | 'avatar'
  | 'hand';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, color = '#FFFFFF' }) => {
  switch (name) {
    case 'app-logo':
      // Blue rounded card with screen & mini device
      return (
        <View
          style={[
            styles.appLogoContainer,
            {
              width: size,
              height: size,
              borderRadius: Math.round(size * 0.28),
              backgroundColor: '#2563EB',
            },
          ]}
        >
          {/* Main monitor outline */}
          <View
            style={{
              width: size * 0.44,
              height: size * 0.34,
              borderWidth: Math.max(1.5, size * 0.06),
              borderColor: '#FFFFFF',
              borderRadius: 3,
              position: 'absolute',
              top: size * 0.26,
              left: size * 0.22,
            }}
          />
          {/* Monitor stand */}
          <View
            style={{
              width: Math.max(2, size * 0.08),
              height: size * 0.1,
              backgroundColor: '#FFFFFF',
              position: 'absolute',
              top: size * 0.58,
              left: size * 0.32,
            }}
          />
          <View
            style={{
              width: size * 0.22,
              height: Math.max(1.5, size * 0.05),
              backgroundColor: '#FFFFFF',
              position: 'absolute',
              top: size * 0.66,
              left: size * 0.25,
              borderRadius: 1,
            }}
          />
          {/* Small phone overlay on bottom-right */}
          <View
            style={{
              width: size * 0.22,
              height: size * 0.36,
              borderWidth: Math.max(1.5, size * 0.06),
              borderColor: '#FFFFFF',
              borderRadius: 4,
              backgroundColor: '#2563EB',
              position: 'absolute',
              top: size * 0.38,
              right: size * 0.2,
            }}
          />
        </View>
      );

    case 'help-hands':
      // Onboarding rounded dark blue box with hand icon
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.3),
            backgroundColor: '#132342',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: size * 0.45, color: '#38BDF8' }}>🤝</Text>
        </View>
      );

    case 'home':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.9, color }}>⌂</Text>
        </View>
      );

    case 'devices':
      return (
        <View
          style={{
            width: size * 0.65,
            height: size,
            borderWidth: 2,
            borderColor: color,
            borderRadius: 4,
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: 2,
          }}
        >
          <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }} />
        </View>
      );

    case 'sessions':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.8, color, fontWeight: 'bold' }}>↺</Text>
        </View>
      );

    case 'settings':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.85, color }}>⚙</Text>
        </View>
      );

    case 'copy':
      return (
        <View style={{ width: size, height: size, position: 'relative' }}>
          <View
            style={{
              width: size * 0.65,
              height: size * 0.65,
              borderWidth: 1.5,
              borderColor: color,
              borderRadius: 2,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />
          <View
            style={{
              width: size * 0.65,
              height: size * 0.65,
              borderWidth: 1.5,
              borderColor: color,
              borderRadius: 2,
              position: 'absolute',
              bottom: 0,
              right: 0,
              backgroundColor: '#131D2E',
            }}
          />
        </View>
      );

    case 'bell':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.8, color }}>🔔</Text>
        </View>
      );

    case 'close':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.85, color, fontWeight: 'bold' }}>✕</Text>
        </View>
      );

    case 'outgoing':
      // Arrow pointing up-right
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: 8,
            backgroundColor: '#1E2D4A',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: size * 0.6, color: '#38BDF8', fontWeight: 'bold' }}>↗</Text>
        </View>
      );

    case 'incoming':
      // Arrow pointing down-left
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: 8,
            backgroundColor: '#13283B',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: size * 0.6, color: '#38BDF8', fontWeight: 'bold' }}>↙</Text>
        </View>
      );

    case 'connect-screen':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.75, color }}>💻</Text>
        </View>
      );

    case 'screen-share':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.85, color }}>📲</Text>
        </View>
      );

    case 'shield-warn':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.85, color }}>🛡️</Text>
        </View>
      );

    case 'back':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size, color, fontWeight: 'bold' }}>←</Text>
        </View>
      );

    case 'clock':
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 1.5,
              height: size * 0.35,
              backgroundColor: color,
              position: 'absolute',
              top: size * 0.15,
            }}
          />
          <View
            style={{
              width: size * 0.25,
              height: 1.5,
              backgroundColor: color,
              position: 'absolute',
              top: size * 0.48,
              left: size * 0.48,
            }}
          />
        </View>
      );

    case 'eye':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.8, color }}>👁</Text>
        </View>
      );

    case 'eye-off':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.8, color }}>🙈</Text>
        </View>
      );

    case 'chevron-right':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.9, color, fontWeight: 'bold' }}>›</Text>
        </View>
      );

    case 'phone':
      return (
        <View
          style={{
            width: size * 0.65,
            height: size,
            borderWidth: 1.5,
            borderColor: color,
            borderRadius: 3,
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: 2,
          }}
        >
          <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: color }} />
        </View>
      );

    case 'window':
      return (
        <View
          style={{
            width: size,
            height: size * 0.8,
            borderWidth: 1.5,
            borderColor: color,
            borderRadius: 3,
            paddingTop: 3,
            paddingHorizontal: 2,
          }}
        >
          <View style={{ width: '100%', height: 1.5, backgroundColor: color }} />
        </View>
      );

    case 'bank':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.8, color }}>🏛</Text>
        </View>
      );

    case 'bell-slash':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.8, color }}>🔕</Text>
        </View>
      );

    case 'stop-circle':
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: size * 0.35, height: size * 0.35, backgroundColor: color, borderRadius: 1 }} />
        </View>
      );

    case 'zoom':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.8, color }}>🔍</Text>
        </View>
      );

    case 'fullscreen':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.85, color, fontWeight: 'bold' }}>⛶</Text>
        </View>
      );

    case 'recents':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: size * 0.6, height: size * 0.6, borderWidth: 1.5, borderColor: color, borderRadius: 2 }} />
        </View>
      );

    case 'type':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.85, color }}>⌨</Text>
        </View>
      );

    case 'tap':
      return (
        <View
          style={{
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: (size * 0.7) / 2,
            borderWidth: 2,
            borderColor: color,
          }}
        />
      );

    case 'disconnect':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.75, color, fontWeight: 'bold' }}>✕</Text>
        </View>
      );

    case 'avatar':
      return (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: '#1E2D4A',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: size * 0.5, color: '#94A3B8' }}>👤</Text>
        </View>
      );

    case 'hand':
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: size * 0.8, color }}>✋</Text>
        </View>
      );

    default:
      return null;
  }
};

const styles = StyleSheet.create({
  appLogoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
});
