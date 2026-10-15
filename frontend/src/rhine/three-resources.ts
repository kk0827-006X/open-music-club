import * as THREE from "three";

/** Dispose shared resources once before dropping the scene's JS references. */
export function collectThreeTextures(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of [object.material, object.userData.fullMaterial, object.userData.fastMaterial].flat())
      if (material instanceof THREE.Material)
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  });
  return textures;
}
export function disposeThreeTree(root: THREE.Object3D, retainedTextures = new Set<THREE.Texture>()) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    for (const material of [object.material, object.userData.fullMaterial, object.userData.fastMaterial].flat())
      if (material instanceof THREE.Material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  if (root instanceof THREE.Scene) {
    if (root.environment) textures.add(root.environment);
    if (root.background instanceof THREE.Texture) textures.add(root.background);
    const target = root.userData.archiveEnvironment;
    if (target instanceof THREE.WebGLRenderTarget) {
      textures.delete(target.texture);
      target.dispose();
      delete root.userData.archiveEnvironment;
    }
  }
  geometries.forEach(geometry => geometry.dispose());
  textures.forEach(texture => { if (!retainedTextures.has(texture)) texture.dispose(); });
  root.clear();
}
