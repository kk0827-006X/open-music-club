import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

const AUTO_HIDE_DELAY = 320;

export function usePlayerVisibility({
  animationRef,
  onExpandedChangedRef,
}: {
  animationRef: RefObject<{ readonly active: boolean } | null>;
  onExpandedChangedRef: RefObject<(open: boolean) => void>;
}) {
  const [queueOpen, setQueueOpenState] = useState(false);
  const [expanded, setExpandedState] = useState(false);
  const [playerVisible, setPlayerVisibleState] = useState(false);
  const expandedRef = useRef(false);
  const queueOpenRef = useRef(false);
  const visibleRef = useRef(false);
  const hideTimerRef = useRef(0);
  const footerRef = useRef<HTMLElement | null>(null);
  const expandedSectionRef = useRef<HTMLElement | null>(null);
  const queueToggleRef = useRef<HTMLButtonElement | null>(null);
  const expandedQueueToggleRef = useRef<HTMLButtonElement | null>(null);
  const queuePanelRef = useRef<HTMLElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const compactOpenButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(false);
  const setVisible = useCallback((visible: boolean) => {
    visibleRef.current = visible;
    setPlayerVisibleState(visible);
  }, []);

  const cancelPlayerHide = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = 0;
  }, []);

  const schedulePlayerHide = useCallback(() => {
    if (animationRef.current?.active) return;
    if (hideTimerRef.current || expandedRef.current || queueOpenRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = 0;
      if (expandedRef.current || queueOpenRef.current || animationRef.current?.active) return;
      const active = document.activeElement;
      if (
        footerRef.current?.contains(active) &&
        active instanceof HTMLElement &&
        active.matches(':focus-visible')
      )
        return;
      setVisible(false);
    }, AUTO_HIDE_DELAY);
  }, [setVisible]);

  const setQueueOpen = useCallback(
    (open: boolean) => {
      queueOpenRef.current = open;
      setQueueOpenState(open);
      if (open) {
        cancelPlayerHide();
        setVisible(true);
      } else schedulePlayerHide();
    },
    [cancelPlayerHide, schedulePlayerHide, setVisible],
  );

  const setExpanded = useCallback(
    (open: boolean, restoreFocus = false) => {
      expandedRef.current = open;
      restoreFocusRef.current = restoreFocus;
      setExpandedState(open);
      onExpandedChangedRef.current(open);
      if (open) {
        setQueueOpen(false);
        cancelPlayerHide();
        setVisible(true);
      } else {
        setQueueOpen(false);
        cancelPlayerHide();
        setVisible(true);
        schedulePlayerHide();
      }
    },
    [cancelPlayerHide, schedulePlayerHide, setQueueOpen, setVisible],
  );

  useEffect(() => {
    let entry: HTMLButtonElement | null = null;
    if (expanded) entry = closeButtonRef.current;
    else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      const openButton = openButtonRef.current;
      // 窄屏隐藏了右侧文字入口，焦点应返回仍可见的歌曲信息按钮。
      const tail = openButton?.parentElement;
      entry =
        tail && window.getComputedStyle(tail).display === 'none'
          ? compactOpenButtonRef.current
          : openButton;
    } else {
      const active = document.activeElement;
      if (expandedSectionRef.current?.contains(active) && active instanceof HTMLElement)
        active.blur();
      return;
    }
    const previousFocus = document.activeElement;
    let frame = 0;
    const deadline = performance.now() + 1200;
    // 可见性可能仍处于退出/进入过渡；只在本次过渡内短暂重试，用户另选焦点即停止。
    const restoreEntryFocus = () => {
      const active = document.activeElement;
      if (active !== previousFocus && active !== document.body && active !== entry) return;
      entry?.focus({ preventScroll: true });
      if (entry && document.activeElement !== entry && performance.now() < deadline)
        frame = requestAnimationFrame(restoreEntryFocus);
    };
    restoreEntryFocus();
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  const onFooterClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const target = event.target;
      // 共享音量滑杆是 Radix 的 span 结构而不是 input，整个音量区都不应触发展开。
      if (!(target instanceof Element) || target.closest('button, input, [data-player-volume]'))
        return;
      setExpanded(true);
    },
    [setExpanded],
  );

  const onPlayerQueueToggle = useCallback(() => {
    setQueueOpen(!queueOpenRef.current);
  }, [setQueueOpen]);

  // 队列浮层打开时，点击面板和队标以外的地方关闭；只关闭浮层，不吞掉同一次点击。
  useEffect(() => {
    if (!queueOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        queuePanelRef.current?.contains(target) ||
        queueToggleRef.current?.contains(target) ||
        expandedQueueToggleRef.current?.contains(target)
      )
        return;
      setQueueOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [queueOpen, setQueueOpen]);

  // 靠近视口底部或指针/焦点进入播放器时显示，离开后 320ms 自动隐藏。
  useEffect(() => {
    const pointermove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || expandedRef.current) return;
      const target = event.target;
      const inside =
        target instanceof Element &&
        Boolean(target.closest('[data-global-player], [data-player-queue-panel]'));
      if (event.clientY >= window.innerHeight - 30 || inside) {
        cancelPlayerHide();
        setVisible(true);
      } else if (visibleRef.current) schedulePlayerHide();
    };
    const pointerout = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !target.closest('[data-global-player], [data-player-queue-panel]')
      )
        return;
      const related = event.relatedTarget;
      if (
        related instanceof Element &&
        related.closest('[data-global-player], [data-player-queue-panel]')
      )
        return;
      schedulePlayerHide();
    };
    const focusin = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-global-player]')) setVisible(true);
    };
    document.addEventListener('pointermove', pointermove);
    document.addEventListener('pointerout', pointerout);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('pointermove', pointermove);
      document.removeEventListener('pointerout', pointerout);
      document.removeEventListener('focusin', focusin);
    };
  }, [cancelPlayerHide, schedulePlayerHide, setVisible]);

  const revealForFlight = useCallback(() => {
    cancelPlayerHide();
    setVisible(true);
  }, [cancelPlayerHide, setVisible]);

  const closeQueue = useCallback(() => setQueueOpen(false), [setQueueOpen]);
  const focusQueueToggle = useCallback(() => {
    (expandedRef.current ? expandedQueueToggleRef : queueToggleRef).current?.focus({
      preventScroll: true,
    });
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  return {
    queueOpen,
    expanded,
    playerVisible,
    expandedRef,
    footerRef,
    expandedSectionRef,
    queueToggleRef,
    expandedQueueToggleRef,
    queuePanelRef,
    openButtonRef,
    compactOpenButtonRef,
    closeButtonRef,
    setQueueOpen,
    setExpanded,
    closeQueue,
    focusQueueToggle,
    onFooterClick,
    onPlayerQueueToggle,
    revealForFlight,
    schedulePlayerHide,
  };
}
