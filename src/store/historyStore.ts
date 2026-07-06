import { create } from 'zustand';

import { HistoryStore } from '../history/HistoryStore';
import type { IHistoryStore } from '../types/interfaces';
import type { MetricsSummary, QASession } from '../types/models';

const history = new HistoryStore();

export interface HistoryStoreState {
  sessions: QASession[];
  metricsSummary: MetricsSummary;
  refresh: () => void;
  save: (session: QASession) => void;
  get: (id: string) => QASession | null;
  delete: (id: string) => void;
  clear: () => void;
  setFlag: (id: string, flagged: boolean, note?: string) => void;
  list: (limit?: number, offset?: number) => QASession[];
  getMetricsSummary: () => MetricsSummary;
}

export const useHistoryStore = create<HistoryStoreState>((set) => ({
  sessions: history.list(),
  metricsSummary: history.getMetricsSummary(),
  refresh: (): void => {
    set(snapshot());
  },
  save: (session: QASession): void => {
    history.save(session);
    set(snapshot());
  },
  get: (id: string): QASession | null => history.get(id),
  delete: (id: string): void => {
    history.delete(id);
    set(snapshot());
  },
  clear: (): void => {
    history.clear();
    set(snapshot());
  },
  setFlag: (id: string, flagged: boolean, note?: string): void => {
    history.setFlag(id, flagged, note);
    set(snapshot());
  },
  list: (limit?: number, offset?: number): QASession[] => history.list(limit, offset),
  getMetricsSummary: (): MetricsSummary => history.getMetricsSummary(),
}));

export const historyStore: IHistoryStore = {
  save: (session: QASession): void => useHistoryStore.getState().save(session),
  get: (id: string): QASession | null => useHistoryStore.getState().get(id),
  list: (limit?: number, offset?: number): QASession[] =>
    useHistoryStore.getState().list(limit, offset),
  delete: (id: string): void => useHistoryStore.getState().delete(id),
  clear: (): void => useHistoryStore.getState().clear(),
  setFlag: (id: string, flagged: boolean, note?: string): void =>
    useHistoryStore.getState().setFlag(id, flagged, note),
  getMetricsSummary: (): MetricsSummary => useHistoryStore.getState().getMetricsSummary(),
};

function snapshot(): Pick<HistoryStoreState, 'sessions' | 'metricsSummary'> {
  return {
    sessions: history.list(),
    metricsSummary: history.getMetricsSummary(),
  };
}
