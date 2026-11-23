import {
  createElement,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type DialogHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { glyphs, paths, type UiIconName } from '../ui/icons.ts';

// 与原图标共用唯一的静态几何定义；不插入 HTML，也不解析任何用户内容。
const geometries = new Map<string, ReactNode>();
function geometry(name: keyof typeof paths) {
  if (!geometries.has(name)) {
    const shapes = [...paths[name].matchAll(/<(path|circle|rect)\s+([^>]*?)\s*\/>/g)].map(
      (match, index) => {
        const attributes: Record<string, string | number> = { key: index };
        for (const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
          const key = attribute[1].replace(/-([a-z])/g, (_, letter: string) =>
            letter.toUpperCase(),
          );
          attributes[key] = attribute[2];
        }
        return createElement(match[1], attributes);
      },
    );
    geometries.set(name, shapes);
  }
  return geometries.get(name);
}
export function Icon({
  name,
  filled = false,
  className = '',
  ...props
}: { name: UiIconName; filled?: boolean } & HTMLAttributes<HTMLElement>) {
  if (name in glyphs)
    return (
      <span
        {...props}
        className={`ui-icon ${className}`.trim()}
        data-ui-icon={name}
        aria-hidden="true"
      >
        {glyphs[name as keyof typeof glyphs]}
      </span>
    );
  return (
    <svg
      className={`ui-icon ${className}`.trim()}
      data-ui-icon={name}
      data-filled={String(filled)}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={props.style}
    >
      {geometry(name as keyof typeof paths)}
    </svg>
  );
}
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: UiIconName; filled?: boolean }
>(function IconButton({ icon, filled, children, type = 'button', ...props }, ref) {
  return (
    <button {...props} ref={ref} type={type}>
      <Icon name={icon} filled={filled} />
      {children}
    </button>
  );
});

export function ModalAction({
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} type={type} data-modal-action>
      <span>{children}</span>
      <Icon name="right" />
    </button>
  );
}

export function Brand({ statistics = false }: { statistics?: boolean }) {
  return (
    <header className="archive-brand">
      <h1>OPEN MUSIC CLUB</h1>
      <p>MUSIC ARCHIVE&nbsp;&nbsp;/&nbsp;&nbsp;社区音乐终端</p>
      {statistics && (
        <small>
          <i />
          24 张精选专辑 · 3 排陈列 · 6 位艺术家
        </small>
      )}
    </header>
  );
}

type ModalProps = Omit<DialogHTMLAttributes<HTMLDialogElement>, 'open' | 'onClose'> & {
  open: boolean;
  busy?: boolean;
  closeButton?: { label: string; marker?: `data-${string}` };
  onClose(): void;
  children: ReactNode;
};

function isBackdrop({
  target,
  currentTarget,
  clientX,
  clientY,
}: ReactMouseEvent<HTMLDialogElement>) {
  if (target !== currentTarget) return false;
  const { left, right, top, bottom } = currentTarget.getBoundingClientRect();
  return clientX < left || clientX > right || clientY < top || clientY > bottom;
}

// 保留原生 top layer、焦点围栏和 ::backdrop，React 只拥有内容和开闭状态。
export function Modal({
  open,
  busy = false,
  closeButton,
  onClose,
  children,
  className = '',
  onCancel,
  onClick,
  onPointerDown,
  ...props
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const startedOutside = useRef(false);
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };
  const requestClose = () => {
    if (!latest.current.busy) latest.current.onClose();
  };
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    startedOutside.current = false;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  // 原登录/设置已经拥有180ms退场；这里不重复计时，以免top layer残留阻挡点击。
  return (
    <dialog
      {...props}
      ref={ref}
      className={className}
      data-modal
      onCancel={(event) => {
        event.preventDefault();
        onCancel?.(event);
        requestClose();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        startedOutside.current = !event.defaultPrevented && event.button === 0 && isBackdrop(event);
      }}
      onClick={(event) => {
        onClick?.(event);
        const close = startedOutside.current && !event.defaultPrevented && isBackdrop(event);
        startedOutside.current = false;
        if (close) requestClose();
      }}
    >
      {children}
      <IconButton
        {...(closeButton?.marker ? { [closeButton.marker]: true } : {})}
        data-modal-close
        icon="close"
        aria-label={closeButton?.label ?? '关闭弹窗'}
        disabled={busy}
        onClick={requestClose}
      />
    </dialog>
  );
}
