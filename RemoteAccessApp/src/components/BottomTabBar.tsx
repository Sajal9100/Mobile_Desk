import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { Icon } from './Icon';

export type TabKey = 'Home' | 'Devices' | 'Sessions' | 'Settings';

interface BottomTabBarProps {
  currentTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  currentTab,
  onSelectTab,
}) => {
  const tabs: { key: TabKey; label: string; icon: 'home' | 'devices' | 'sessions' | 'settings' }[] = [
    { key: 'Home', label: 'Home', icon: 'home' },
    { key: 'Devices', label: 'Devices', icon: 'devices' },
    { key: 'Sessions', label: 'Sessions', icon: 'sessions' },
    { key: 'Settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = currentTab === tab.key;
        const color = isActive ? colors.tabActive : colors.tabInactive;

        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabItem}
            onPress={() => onSelectTab(tab.key)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrapper}>
              <Icon name={tab.icon} size={22} color={color} />
            </View>
            <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    height: 64,
    flexDirection: 'row',
    backgroundColor: colors.tabBarBg,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  iconWrapper: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});
