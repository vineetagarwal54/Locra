import { create } from 'zustand';

import { conversationToSession, HistoryStore } from '../history/HistoryStore';
import type { IHistoryStore } from '../types/interfaces';
import type { Conversation, MetricsSummary, QASession } from '../types/models';

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
  saveConversation: (conversation: Conversation) => void;
  getConversation: (id: string) => Conversation | null;
  listConversations: (limit?: number, offset?: number) => Conversation[];
}

export const useHistoryStore = create<HistoryStoreState>((set) => ({
  sessions: history.list().map(conversationToSession),
  metricsSummary: history.getMetricsSummary(),
  refresh: (): void => {
    set(snapshot());
  },
  save: (session: QASession): void => {
    history.save(session);
    set(snapshot());
  },
  get: (id: string): QASession | null => {
    const conversation = history.get(id);
    return conversation === null ? null : conversationToSession(conversation);
  },
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
  list: (limit?: number, offset?: number): QASession[] =>
    history.list(limit, offset).map(conversationToSession),
  getMetricsSummary: (): MetricsSummary => history.getMetricsSummary(),
  saveConversation: (conversation: Conversation): void => {
    history.save(conversation);
    set(snapshot());
  },
  getConversation: (id: string): Conversation | null => history.get(id),
  listConversations: (limit?: number, offset?: number): Conversation[] =>
    history.list(limit, offset),
}));

export const historyStore: IHistoryStore = {
  save: (conversation: Conversation): void =>
    useHistoryStore.getState().saveConversation(conversation),
  get: (id: string): Conversation | null => useHistoryStore.getState().getConversation(id),
  list: (limit?: number, offset?: number): Conversation[] =>
    useHistoryStore.getState().listConversations(limit, offset),
  delete: (id: string): void => useHistoryStore.getState().delete(id),
  clear: (): void => useHistoryStore.getState().clear(),
  setFlag: (id: string, flagged: boolean, note?: string): void =>
    useHistoryStore.getState().setFlag(id, flagged, note),
  getMetricsSummary: (): MetricsSummary => useHistoryStore.getState().getMetricsSummary(),
};

function snapshot(): Pick<HistoryStoreState, 'sessions' | 'metricsSummary'> {
  return {
    sessions: history.list().map(conversationToSession),
    metricsSummary: history.getMetricsSummary(),
  };
}
