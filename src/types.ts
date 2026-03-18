export interface EventData {
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  description: string;
}

export type EventStatus = 'added' | 'discarded';

export interface HistoryEntry {
  id: string;
  event: EventData;
  status: EventStatus;
  created_at: string;
}
