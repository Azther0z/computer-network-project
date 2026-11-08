'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ack } from '../../../lib/account-types';
import type { ChatMessage } from '../../../lib/chat-types';

export type HistoryPage = {
  roomId: string;
  messages: ChatMessage[];
  nextBeforeSeq: number | null;
  highWatermarkSeq: number;
};
type Query = { roomId: string; beforeSeq?: number };
type Request = <T>(event: string, payload: object) => Promise<Ack<T>>;
type PageState = {
  roomId: string | null;
  loading: boolean;
  nextBeforeSeq: number | null;
  failed: Query | null;
};

/** Owns read requests only. A failed query is retried only by its Retry button. */
export function useRoomHistory({ roomId, enabled, connectionId, request, onPage }: {
  roomId: string | null;
  enabled: boolean;
  connectionId?: string;
  request: Request;
  onPage(page: HistoryPage, older: boolean): void;
}) {
  const requestRef = useRef(request);
  const onPageRef = useRef(onPage);
  requestRef.current = request;
  onPageRef.current = onPage;
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [state, setState] = useState<PageState>({ roomId: null, loading: false, nextBeforeSeq: null, failed: null });

  const load = useCallback(async (query: Query, current: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState(previous => ({ ...previous, roomId: query.roomId, loading: true, failed: null }));
    try {
      const response = await requestRef.current<HistoryPage>('room.history', query);
      if (generation.current !== current) return;
      if (!response.ok || response.data.roomId !== query.roomId) {
        setState(previous => ({ ...previous, failed: query }));
        return;
      }
      onPageRef.current(response.data, query.beforeSeq !== undefined);
      setState({ roomId: query.roomId, nextBeforeSeq: response.data.nextBeforeSeq, loading: false, failed: null });
    } catch {
      if (generation.current === current) setState(previous => ({ ...previous, failed: query }));
    } finally {
      if (generation.current === current) {
        inFlight.current = false;
        setState(previous => ({ ...previous, loading: false }));
      }
    }
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    inFlight.current = false;
    setState({ roomId, loading: false, nextBeforeSeq: null, failed: null });
    if (enabled && roomId) void load({ roomId }, current);
    return () => { generation.current = current + 1; inFlight.current = false; };
  }, [roomId, enabled, connectionId, load]);

  const selected = state.roomId === roomId;
  return {
    loading: selected && state.loading,
    failed: selected && state.failed !== null,
    canLoadOlder: selected && state.nextBeforeSeq != null && !state.failed,
    loadOlder() {
      if (enabled && roomId && selected && state.nextBeforeSeq != null) {
        void load({ roomId, beforeSeq: state.nextBeforeSeq }, generation.current);
      }
    },
    retry() {
      if (enabled && selected && state.failed) void load(state.failed, generation.current);
    },
  };
}
