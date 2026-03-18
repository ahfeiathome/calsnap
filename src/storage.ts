import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HistoryEntry } from './types';

const HISTORY_KEY = 'calsnap_history';
const MAX_ENTRIES = 20;

export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as HistoryEntry[];
}

export async function saveToHistory(entry: HistoryEntry): Promise<void> {
  const existing = await getHistory();
  existing.unshift(entry);
  const trimmed = existing.slice(0, MAX_ENTRIES);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}
