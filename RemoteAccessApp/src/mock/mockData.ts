export interface DeviceItem {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'unknown';
  isCurrentDevice?: boolean;
  lastSeen?: string;
}

export interface SessionItem {
  id: string;
  deviceName: string;
  deviceId: string;
  direction: 'incoming' | 'outgoing';
  status: 'completed' | 'rejected' | 'expired';
  timestamp: string;
  duration?: string;
}

export interface UserProfile {
  name: string;
  email: string;
  thisPhoneName: string;
  thisPhoneId: string;
}

export interface SettingsState {
  hideIpAddress: boolean;
  onlyAcceptFromMyDevices: boolean;
  requireOneTimePin: boolean;
}

export const initialUserProfile: UserProfile = {
  name: 'Sample User',
  email: 'sample.user@example.com',
  thisPhoneName: 'Pixel 8 (this phone)',
  thisPhoneId: '482 915 736',
};

export const initialDevices: DeviceItem[] = [
  {
    id: '482 915 736',
    name: 'Pixel 8 (this phone)',
    status: 'unknown',
    isCurrentDevice: true,
  },
  {
    id: '731 004 582',
    name: "Mom's Galaxy A54",
    status: 'online',
  },
  {
    id: '209 558 143',
    name: 'Office Redmi Note 13',
    status: 'offline',
    lastSeen: 'seen yesterday',
  },
];

export const initialSessions: SessionItem[] = [
  {
    id: 'sess-1',
    deviceName: "Mom's Galaxy A54",
    deviceId: '731 004 582',
    direction: 'outgoing',
    status: 'completed',
    timestamp: 'Nov 24, 09:06 AM',
    duration: '12m 14s',
  },
  {
    id: 'sess-2',
    deviceName: 'Office Redmi Note 13',
    deviceId: '209 558 143',
    direction: 'incoming',
    status: 'rejected',
    timestamp: 'Nov 23, 12:41 PM',
  },
  {
    id: 'sess-3',
    deviceName: 'Office Redmi Note 13',
    deviceId: '209 558 143',
    direction: 'outgoing',
    status: 'expired',
    timestamp: 'Nov 22, 09:41 AM',
  },
];

export const initialSettings: SettingsState = {
  hideIpAddress: true,
  onlyAcceptFromMyDevices: false,
  requireOneTimePin: false,
};
