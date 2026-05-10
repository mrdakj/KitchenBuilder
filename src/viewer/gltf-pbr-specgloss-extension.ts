import * as THREE from 'three'

// Minimal polyfill for KHR_materials_pbrSpecularGlossiness, dropped from the
// stock three.js GLTFLoader. Approximates spec-gloss with MeshStandardMaterial
// (diffuse -> color/map, glossinessFactor -> roughness).
export class GLTFMaterialsPbrSpecularGlossinessExtension {
  name = 'KHR_materials_pbrSpecularGlossiness'
  parser: any

  constructor(parser: any) {
    this.parser = parser
  }

  getMaterialType() {
    return THREE.MeshStandardMaterial
  }

  extendMaterialParams(materialIndex: number, materialParams: any): Promise<any> {
    const parser = this.parser
    const materialDef = parser.json.materials[materialIndex]
    const ext = materialDef.extensions?.[this.name]
    if (!ext) return Promise.resolve()

    materialParams.color = new THREE.Color(1, 1, 1)
    materialParams.opacity = 1

    const pending: Promise<any>[] = []

    if (Array.isArray(ext.diffuseFactor)) {
      materialParams.color.fromArray(ext.diffuseFactor)
      materialParams.opacity = ext.diffuseFactor[3] ?? 1
    }
    if (ext.diffuseTexture !== undefined) {
      pending.push(parser.assignTexture(materialParams, 'map', ext.diffuseTexture, THREE.SRGBColorSpace))
    }

    materialParams.metalness = 0
    materialParams.roughness = 1 - (ext.glossinessFactor ?? 1)

    if (ext.specularGlossinessTexture !== undefined) {
      pending.push(parser.assignTexture(materialParams, 'roughnessMap', ext.specularGlossinessTexture))
    }

    return Promise.all(pending)
  }
}
