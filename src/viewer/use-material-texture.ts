'use client'

import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useTextures } from '@/core/store/use-textures'

// Resolves a texture URL into a THREE.Texture. Recognises three shapes:
//   - undefined / null     -> no texture
//   - 'tex:<storedId>'     -> read from the user-uploaded textures store
//   - any other string     -> treated as a direct URL (e.g. /assets/...)
//
// `linear=true` is for non-color data (normal / roughness / metalness maps);
// the default sRGB color space is for diffuse color maps. `repeat` sets the
// tiling — passing >1 makes the texture repeat across the surface so a
// plank/tile pattern shows visible detail rather than a single stretched
// copy. The texture is disposed on unmount or when the source changes.
export function useMaterialTexture(
  textureUrl: string | undefined,
  linear = false,
  repeat = 1,
): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const getTextureUrl = useTextures((s) => s.getTextureUrl)
  // Track the meta entry for the referenced stored texture (if any). When the
  // textures store updates — first upload, post-hydration, or appending —
  // this changes and re-triggers the load effect. Without it, the hook
  // sometimes stays stale and you have to refresh the page.
  const storedId = useMemo(
    () => (textureUrl?.startsWith('tex:') ? textureUrl.slice(4) : null),
    [textureUrl],
  )
  const storedMeta = useTextures((s) => (storedId ? s.textures[storedId] : null))

  useEffect(() => {
    let cancelled = false
    let createdObjectUrl: string | null = null
    let createdTexture: THREE.Texture | null = null

    const load = async () => {
      if (!textureUrl) {
        setTex(null)
        return
      }
      let url = textureUrl
      if (url.startsWith('tex:')) {
        const id = url.slice(4)
        const blobUrl = await getTextureUrl(id)
        if (!blobUrl) {
          setTex(null)
          return
        }
        createdObjectUrl = blobUrl
        url = blobUrl
      }
      const loader = new THREE.TextureLoader()
      loader.load(
        url,
        (t) => {
          if (cancelled) {
            t.dispose()
            return
          }
          t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace
          t.wrapS = THREE.RepeatWrapping
          t.wrapT = THREE.RepeatWrapping
          t.repeat.set(repeat, repeat)
          createdTexture = t
          setTex(t)
        },
        undefined,
        () => {
          if (!cancelled) setTex(null)
        },
      )
    }
    load()

    return () => {
      cancelled = true
      if (createdTexture) createdTexture.dispose()
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl)
    }
  }, [textureUrl, getTextureUrl, storedMeta, linear, repeat])

  return tex
}
