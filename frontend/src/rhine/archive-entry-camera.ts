import { smooth } from './motion'

type Point = readonly [number, number, number]

// 同一条连续镜头在两秒内落到工作区参数，端点速度与加速度均为零。
export function archiveEntryCamera(seconds: number, target: {
  yaw: number; elevation: number; distance: number; span: number; aim: Point
}) {
  const progress = smooth(seconds / 2)
  const remaining = 1 - progress
  const yaw = target.yaw + 6 * Math.PI / 180 * remaining
  const elevation = target.elevation + 13 * Math.PI / 180 * remaining
  const aim: Point = [target.aim[0], target.aim[1] + .35 * remaining, target.aim[2]]
  const position: Point = [
    aim[0] - Math.sin(yaw) * Math.cos(elevation) * target.distance,
    aim[1] + Math.sin(elevation) * target.distance,
    aim[2] + Math.cos(yaw) * Math.cos(elevation) * target.distance,
  ]
  return { aim, position, span: target.span * (1 + .22 * remaining) }
}
