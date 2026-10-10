import * as THREE from 'three'
import { GLASS_TRAIL_SIZE, glassResolution } from './login-glass-motion.ts'
import type { GlassState } from './login-glass-motion.ts'
import type { GlassRenderer } from './login-glass.ts'

// 高度场来自 /Users/kk/liquid-glass/index.html；保留凹陷、拖尾及点击波纹公式。
// 不搬入原项目的背景纹理和绿色调色，只用中性反光叠加在现有背景上。
const heightGLSL = `
uniform float uTime, uAspect, uWave, uDepth, uHover;
uniform vec2 uPointer;
uniform vec3 uRipple;
uniform vec4 uTrail[${GLASS_TRAIL_SIZE}];
uniform float uTrailClock, uMotion;
float heightAt(vec2 p) {
 float t=uTime;
 float h=sin(p.x*2.3+p.y*1.5-t*.75)*.16;
 h+=sin(p.x*3.8-p.y*2.7+t*.55)*.085;
 h+=sin(p.x*1.4+p.y*4.1-t*.45)*.065;
 h*=uWave;
 float d=length(p-uPointer);
 h-=exp(-d*d/0.14)*uDepth*uHover*(.80+uMotion*.40);
 for(int i=0;i<${GLASS_TRAIL_SIZE};i++) {
  float age=max(uTrailClock-uTrail[i].z,0.);
  float fade=exp(-age*2.8)*uTrail[i].w;
  if(fade<.004) continue;
  vec2 offset=p-uTrail[i].xy;
  float r=length(offset);
  float trough=exp(-dot(offset,offset)/(.045+age*.055));
  float wake=sin(r*13.-age*7.)*exp(-r*3.5)*.10;
  h+=(-trough*.28+wake)*fade*uDepth;
 }
 h+=sin(d*16.-t*3.)*exp(-d*2.5)*uHover*uDepth*.018;
 float age=t-uRipple.z;
 float rd=length(p-uRipple.xy);
 if(age>=0. && age<5.) h+=sin(rd*19.-age*8.)*exp(-pow(rd-age*.55,2.)*12.)*exp(-age)*.12;
 return h;
}`

export function createGlassRenderer(shell: HTMLElement): GlassRenderer {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(1); renderer.setClearColor(0, 0)
  shell.querySelector('[data-login-glass]')!.append(renderer.domElement)
  const uniforms = {
    uTime: { value: 0 }, uAspect: { value: 1 }, uWave: { value: .32 }, uDepth: { value: .57 },
    uHover: { value: 0 }, uMotion: { value: 0 }, uTrailClock: { value: 0 }, uPresence: { value: 1 },
    uPointer: { value: new THREE.Vector2() }, uRipple: { value: new THREE.Vector3(0, 0, -100) },
    uTrail: { value: Array.from({ length: GLASS_TRAIL_SIZE }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uSize: { value: new THREE.Vector2() }, uMasks: { value: [new THREE.Vector4()] },
  }
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: false, depthWrite: false,
    // 正交背景无需密集网格；高度场的有限差分仍保留原玻璃法线效果。
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: heightGLSL + `
      uniform float uPresence;
      uniform vec2 uSize;
      uniform vec4 uMasks[1];
      varying vec2 vUv;
      void main(){
        vec2 p=(vUv-.5)*vec2(uAspect*4.,4.);
        float h=heightAt(p), e=.008;
        vec2 slope=vec2(heightAt(p+vec2(e,0.))-heightAt(p-vec2(e,0.)),heightAt(p+vec2(0.,e))-heightAt(p-vec2(0.,e)))/(2.*e);
        vec3 n=normalize(vec3(-slope*1.6,1.));
        vec3 light=normalize(vec3(-.6,.8,1.2));
        float spec=pow(max(dot(n,normalize(light+vec3(0.,0.,1.))),0.),65.);
        float fresnel=pow(1.-max(n.z,0.),2.);
        float ribbon=pow(.5+.5*sin(p.x*2.5+p.y*3.4+h*5.-uTime*.3),16.);
        float shine=spec*.48+fresnel*.24+ribbon*uWave*.12;
        float shade=max(0.,1.-n.z)*.22;
        vec2 pixel=vec2(vUv.x,1.-vUv.y)*uSize;
        float visible=1.;
        for(int i=0;i<1;i++) {
          vec2 outside=max(uMasks[i].xy-pixel,pixel-uMasks[i].zw);
          visible*=smoothstep(0.,24.,max(outside.x,outside.y));
        }
        vec3 color=shine>shade ? vec3(1.,.995,.98) : vec3(.36,.35,.32);
        gl_FragColor=vec4(color,min(abs(shine-shade),.4)*visible*uPresence);
      }`,
  })
  const geometry = new THREE.PlaneGeometry(2, 2)
  const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.Camera()
  let width = 0, height = 0
  return {
    draw(state: GlassState, w: number, h: number, masks: number[][], presence: number) {
      const size = glassResolution(w, h)
      if (size.width !== width || size.height !== height) {
        renderer.setSize(size.width, size.height, false); width = size.width; height = size.height
      }
      uniforms.uTime.value = state.time; uniforms.uAspect.value = w / Math.max(h, 1)
      uniforms.uHover.value = state.hover; uniforms.uMotion.value = state.motion
      uniforms.uTrailClock.value = state.clock; uniforms.uPresence.value = presence
      uniforms.uPointer.value.set(state.x, state.y); uniforms.uRipple.value.fromArray(state.ripple)
      uniforms.uTrail.value.forEach((point, i) => point.fromArray(state.trail[i]))
      uniforms.uSize.value.set(w, h); uniforms.uMasks.value.forEach((mask, i) => mask.fromArray(masks[i]))
      renderer.render(scene, camera)
    },
    clear() { renderer.clear() },
    dispose() {
      geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    },
  }
}
