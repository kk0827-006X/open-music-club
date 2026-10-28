// 基于 Aceternity UI 官方 draggable-card / demo-2：
// https://ui.aceternity.com/registry/draggable-card-demo-2.json
// 保留 Motion 拖动、弹簧倾斜和高光；用站点 CSS 替换 Tailwind，约束到歌单区域。
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useReducedMotion } from '../hooks.ts'

type ContainerRef = RefObject<HTMLDivElement | null>
const springConfig = { stiffness: 100, damping: 20, mass: .5 }

export function DraggableCardContainer({ containerRef, children }: { containerRef: ContainerRef; children: ReactNode }) {
  return <div ref={containerRef} className="user-playlist-deck" data-playlist-deck>{children}</div>
}

export function DraggableCardBody({ containerRef, children, index, layer, stackSize, raised, disabled, onRaise }: {
  containerRef: ContainerRef; children: ReactNode; index: number; layer: number; stackSize: number; raised: boolean; disabled: boolean; onRaise: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  // 每张卡片只抽取一次位置；列表刷新、聚焦或置顶不重新随机。
  const [placement] = useState(() => ({ x: Math.random(), y: Math.random(), rotate: Math.random() * 16 - 8 }))
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const angle = index < 3 ? [-8, 7, -4][index] : placement.rotate
  const reduced = useReducedMotion()
  const x = useMotionValue(0), y = useMotionValue(0)
  const mouseX = useMotionValue(0), mouseY = useMotionValue(0)
  const rotateX = useSpring(useTransform(mouseY, [-300, 300], [25, -25]), springConfig)
  const rotateY = useSpring(useTransform(mouseX, [-300, 300], [-25, 25]), springConfig)
  const opacity = useSpring(useTransform(mouseX, [-300, 0, 300], [.8, 1, .8]), springConfig)
  const glareOpacity = useSpring(useTransform(mouseX, [-300, 0, 300], [.2, 0, .2]), springConfig)
  useEffect(() => {
    const container = containerRef.current
    const card = cardRef.current
    if (!container || !card) return
    const place = () => {
      x.set(0); y.set(0)
      if (index < 3) { setPosition(null); return }
      // 按旋转后的真实尺寸预留边距，新增卡片在可用区域随机重叠。
      const radians = Math.abs(angle) * Math.PI / 180
      const width = card.offsetWidth, height = card.offsetHeight
      const marginX = Math.max(0, (width * Math.cos(radians) + height * Math.sin(radians) - width) / 2) + 4
      const marginY = Math.max(0, (height * Math.cos(radians) + width * Math.sin(radians) - height) / 2) + 4
      setPosition({
        left: marginX + placement.x * Math.max(0, container.clientWidth - width - 2 * marginX),
        top: marginY + placement.y * Math.max(0, container.clientHeight - height - 2 * marginY),
      })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(container)
    observer.observe(card)
    return () => observer.disconnect()
  }, [containerRef, x, y, index, angle, placement])
  const resetTilt = () => { mouseX.set(0); mouseY.set(0) }
  return <motion.div ref={cardRef} className={`user-draggable-card user-draggable-card-${index}`}
    data-draggable-card drag={!disabled} dragConstraints={containerRef} dragElastic={0} dragMomentum={false}
    style={{ x, y, left: position?.left, top: position?.top, rotate: angle, rotateX: reduced ? 0 : rotateX,
      rotateY: reduced ? 0 : rotateY, opacity: reduced ? 1 : opacity, zIndex: raised ? stackSize + 1 : layer }}
    whileHover={disabled || reduced ? undefined : { scale: 1.02 }}
    onPointerDownCapture={() => { dragged.current = false; onRaise() }} onFocusCapture={onRaise}
    onDragStart={() => { dragged.current = true; resetTilt() }} onDragEnd={resetTilt}
    onClickCapture={event => {
      // 鼠标/触摸拖动结束产生的 click 不能打开歌单；键盘激活仍然可用。
      if (dragged.current && event.detail > 0) { event.preventDefault(); event.stopPropagation() }
    }}
    onMouseMove={event => {
      if (disabled || reduced || dragged.current) return
      const rect = cardRef.current?.getBoundingClientRect()
      if (rect) { mouseX.set(event.clientX - rect.left - rect.width / 2); mouseY.set(event.clientY - rect.top - rect.height / 2) }
    }} onMouseLeave={resetTilt}>
    {children}
    <motion.div aria-hidden="true" className="user-draggable-glare" style={{ opacity: reduced ? 0 : glareOpacity }} />
  </motion.div>
}
