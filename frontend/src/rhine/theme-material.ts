import * as THREE from "three";
import { getThemeState, themeColor } from '../shared/theme.ts';

const surfaces: Record<string, string> = {
  Frosted_Polymer: "--scene-dark-polymer", Ivory_Edges: "--scene-dark-edges", Optical_Diffuser: "--scene-dark-diffuser",
  Titanium_Fasteners: "--scene-dark-fasteners", Index_Inlay: "--scene-dark-inlay", Printed_Label: "--scene-dark-label",
  Subsurface_Optics: "--scene-dark-optics", Optical_Edges: "--scene-dark-optical-edges", Carbon_Ink: "--scene-dark-ink",
};
/** Extend existing optical shaders; one float per instance avoids new meshes or passes. */
export function themeMaterial(material: THREE.Material, name: string, instanced = false, subduedIndex = { value: 0 }) {
  const amount = { value: 0 };
  const before = material.onBeforeCompile;
  const cache = material.customProgramCacheKey.bind(material)();
  const token = surfaces[name] ?? (name.includes("Orange") ? '--scene-dark-orange' : '--scene-dark-other');
  const color = new THREE.Color(themeColor(token as `--${string}`) || 0);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.rhineTheme = amount;
    shader.uniforms.rhineDarkSurface = { value: color };
    shader.uniforms.rhineSubduedIndex = subduedIndex;
    if (instanced) {
      shader.vertexShader = "attribute float archiveTheme; varying float vRhineTheme;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvRhineTheme = archiveTheme;");
      shader.fragmentShader = "varying float vRhineTheme;\n" + shader.fragmentShader;
    }
    shader.fragmentShader = "uniform float rhineTheme; uniform vec3 rhineDarkSurface; uniform float rhineSubduedIndex;\n" + shader.fragmentShader;
    const mix = instanced ? "vRhineTheme" : "rhineTheme";
    const printed = name === "Printed_Canvas";
    const anchor = printed ? "#include <opaque_fragment>" : "#include <roughnessmap_fragment>";
    const dark = printed
      ? "mix(vec3(0.023, 0.032, 0.037), vec3(0.78, 0.78, 0.71), 1.0 - smoothstep(0.12, 0.65, dot(diffuseColor.rgb, vec3(.2126,.7152,.0722))))"
      : name === "Frosted_Polymer" && !instanced
        ? "mix(rhineDarkSurface, vec3(0.92, 0.96, 0.97), glassRevealAtHeight(archiveClarity, vArchiveHeight))"
        : name === "Index_Inlay" ? "mix(rhineDarkSurface, vec3(0.030, 0.042, 0.048), rhineSubduedIndex)" : "rhineDarkSurface";
    const output = printed ? "outgoingLight" : "diffuseColor.rgb";
    shader.fragmentShader = shader.fragmentShader.replace(anchor, `${output} = mix(${output}, ${dark}, ${mix});\n${anchor}`);
  };
  material.customProgramCacheKey = () => `${cache}-rhine-theme-${name}-${instanced}`;
  return amount;
}

type Baseline = { background: THREE.Color; fog?: THREE.Color; intensity: number; exposure: number; lights: { light: THREE.Light; intensity: number }[]; floor?: { material: THREE.MeshStandardMaterial; color: THREE.Color } };
const scenes = new WeakMap<THREE.Scene, Baseline>();
const background = new THREE.Color(), floorColor = new THREE.Color(), mistColor = new THREE.Color();
let paletteTheme = '';
export function themeEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, amount: number) {
  let baseline = scenes.get(scene);
  if (!baseline) {
    const lights: Baseline["lights"] = [];
    scene.traverse(object => { if (object instanceof THREE.Light) lights.push({ light: object, intensity: object.intensity }); });
    const floor = scene.getObjectByName("archive-floor") as THREE.Mesh | undefined;
    const material = floor?.material as THREE.MeshStandardMaterial | undefined;
    baseline = { background: (scene.background as THREE.Color).clone(), fog: scene.fog?.color.clone(), intensity: scene.environmentIntensity,
      exposure: renderer.toneMappingExposure, lights, floor: material ? { material, color: material.color.clone() } : undefined };
    scenes.set(scene, baseline);
  }
  // 只在主题变化时读取 CSS 配置，不在每帧触发 getComputedStyle。
  const resolved = getThemeState().resolved;
  if (resolved !== paletteTheme) {
    const color = themeColor('--scene-background');
    if (color) {
      background.set(color); floorColor.set(themeColor('--scene-floor')); mistColor.set(themeColor('--scene-fog'));
      paletteTheme = resolved;
    }
  }
  (scene.background as THREE.Color).copy(paletteTheme ? background : baseline.background);
  if (scene.fog && baseline.fog) scene.fog.color.copy(paletteTheme ? mistColor : baseline.fog);
  if (baseline.floor) baseline.floor.material.color.copy(paletteTheme ? floorColor : baseline.floor.color);
  scene.environmentIntensity = THREE.MathUtils.lerp(baseline.intensity, .32, amount);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(baseline.exposure, .98, amount);
  for (const { light, intensity } of baseline.lights) light.intensity = intensity * (1 - .35 * amount);
}
