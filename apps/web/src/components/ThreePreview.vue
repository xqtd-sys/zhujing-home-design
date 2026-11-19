<script setup lang="ts">
import type { PlanDocument } from '@home-design/plan-schema'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAssetsStore } from '../stores/assets'
import { useThemeMode } from '../composables/useThemeMode'

type Selection = { type: 'wall' | 'opening' | 'room' | 'furniture'; id: string }

const props = defineProps<{ document: PlanDocument; selection?: Selection | null }>()
const assets = useAssetsStore()
const { mode } = useThemeMode()

/** 2D 选中对象在 3D 中高亮，形成 2D↔3D 联动。 */
const HIGHLIGHT_EMISSIVE = 0x0e9d8c

function isSelected(type: Selection['type'], id: string) {
  return props.selection?.type === type && props.selection.id === id
}

function highlightMaterial<T extends THREE.MeshStandardMaterial>(material: T, highlighted: boolean): T {
  if (highlighted) {
    material.emissive = new THREE.Color(HIGHLIGHT_EMISSIVE)
    material.emissiveIntensity = 0.55
  }
  return material
}

/** 3D 背景跟随昼夜主题：夜间深色，白昼沿用原来的浅灰绿。 */
function themeBackground() {
  return mode.value === 'day' ? '#dfe7e4' : '#0a0e17'
}

/** 地面颜色跟随主题，避免夜间一块亮灰色突兀。 */
function groundColor() {
  return mode.value === 'day' ? 0xd3dbd5 : 0x161d28
}

const host = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer | undefined
let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let controls: OrbitControls | undefined
let sceneRoot: THREE.Group | undefined
let ground: THREE.Mesh | undefined
let keyLight: THREE.DirectionalLight | undefined
let resizeObserver: ResizeObserver | undefined
let animationFrame = 0
let hasInitialFit = false

const WORLD_SCALE = 0.01

function toWorld(value: number) {
  return value * WORLD_SCALE
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  const materials = Array.isArray(material) ? material : [material]
  materials.forEach((item) => item.dispose())
}

function clearSceneRoot() {
  if (!sceneRoot) return
  sceneRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    disposeMaterial(object.material)
  })
  sceneRoot.clear()
}

function wallDirection(wall: PlanDocument['walls'][number]) {
  return {
    length: Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y),
    angle: -Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x),
  }
}

function wallPoint(wall: PlanDocument['walls'][number], offset: number) {
  const length = Math.max(1, Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y))
  const ratio = offset / length
  return {
    x: toWorld(wall.start.x + (wall.end.x - wall.start.x) * ratio),
    z: toWorld(wall.start.y + (wall.end.y - wall.start.y) * ratio),
  }
}

function wallMaterial(color = 0xe6e2d7, highlighted = false) {
  return highlightMaterial(
    new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    highlighted,
  )
}

function addWallSegment(
  wall: PlanDocument['walls'][number],
  startOffset: number,
  endOffset: number,
  bottom: number,
  height: number,
  highlighted = false,
) {
  if (!sceneRoot || endOffset - startOffset <= 0.01 || height <= 0.01) return
  const { angle } = wallDirection(wall)
  const start = wallPoint(wall, startOffset)
  const end = wallPoint(wall, endOffset)
  const center = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 }
  const geometry = new THREE.BoxGeometry(toWorld(endOffset - startOffset), toWorld(height), toWorld(wall.thickness))
  const mesh = new THREE.Mesh(geometry, wallMaterial(0xe6e2d7, highlighted))
  mesh.position.set(center.x, toWorld(bottom + height / 2), center.z)
  mesh.rotation.y = angle
  mesh.castShadow = true
  mesh.receiveShadow = true
  sceneRoot.add(mesh)
}

function addWall(wall: PlanDocument['walls'][number]) {
  const highlighted = isSelected('wall', wall.id)
  const { length } = wallDirection(wall)
  const openings = props.document.openings
    .filter((opening) => opening.wallId === wall.id)
    .sort((a, b) => a.offset - b.offset)
  if (!openings.length) {
    addWallSegment(wall, 0, length, 0, wall.height, highlighted)
    return
  }

  const cuts = [0, ...openings.flatMap((opening) => [opening.offset, opening.offset + opening.width]), length]
    .map((value) => Math.max(0, Math.min(length, value)))
    .sort((a, b) => a - b)
  const uniqueCuts = cuts.filter((value, index) => index === 0 || Math.abs(value - cuts[index - 1]) > 0.01)
  for (let index = 0; index < uniqueCuts.length - 1; index += 1) {
    const start = uniqueCuts[index]
    const end = uniqueCuts[index + 1]
    const middle = (start + end) / 2
    const opening = openings.find((item) => middle >= item.offset && middle <= item.offset + item.width)
    if (!opening) {
      addWallSegment(wall, start, end, 0, wall.height, highlighted)
      continue
    }
    if (opening.sillHeight > 0) addWallSegment(wall, start, end, 0, opening.sillHeight, highlighted)
    const top = opening.sillHeight + opening.height
    if (top < wall.height) addWallSegment(wall, start, end, top, wall.height - top, highlighted)
  }
  openings.forEach((opening) => addOpeningPanels(opening, wall))
}

function addRoom(room: PlanDocument['rooms'][number]) {
  if (!sceneRoot || room.polygon.length < 3) return
  const points = [...room.polygon]
  let signedArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    signedArea += current.x * next.y - next.x * current.y
  }
  if (signedArea > 0) points.reverse()
  const shape = new THREE.Shape()
  points.forEach((point, index) => {
    const x = toWorld(point.x)
    const y = -toWorld(point.y)
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  })
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    highlightMaterial(
      new THREE.MeshStandardMaterial({ color: 0xc9bda0, roughness: 0.96, metalness: 0, side: THREE.DoubleSide }),
      isSelected('room', room.id),
    ),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  sceneRoot.add(mesh)
}

function addFurniture(furniture: PlanDocument['furniture'][number]) {
  if (!sceneRoot) return
  const asset = assets.getById(furniture.assetId)
  const name = asset?.name ?? ''
  const base = asset?.color ? new THREE.Color(asset.color) : new THREE.Color('#9aa69d')
  const dark = base.clone().multiplyScalar(0.82)
  const light = base.clone().lerp(new THREE.Color('#ffffff'), 0.42)
  const highlighted = isSelected('furniture', furniture.id)
  const matBase = highlightMaterial(
    new THREE.MeshStandardMaterial({ color: base, roughness: 0.78, metalness: 0.02 }),
    highlighted,
  )
  const matDark = highlightMaterial(
    new THREE.MeshStandardMaterial({ color: dark, roughness: 0.82, metalness: 0.02 }),
    highlighted,
  )
  const matLight = highlightMaterial(
    new THREE.MeshStandardMaterial({ color: light, roughness: 0.7, metalness: 0.02 }),
    highlighted,
  )

  const W = toWorld(furniture.width)
  const H = toWorld(furniture.height)
  const D = toWorld(furniture.depth)

  const group = new THREE.Group()
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(w, 0.0001), Math.max(h, 0.0001), Math.max(d, 0.0001)),
      material,
    )
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  if (name === '沙发') {
    // 坐垫 + 靠背 + 两侧扶手 + 两个抱枕
    part(W, H * 0.42, D, 0, H * 0.21, 0, matBase)
    part(W, H * 0.6, D * 0.22, 0, H * 0.62, -D / 2 + D * 0.11, matDark)
    part(W * 0.12, H * 0.34, D, -W / 2 + W * 0.06, H * 0.42, 0, matDark)
    part(W * 0.12, H * 0.34, D, W / 2 - W * 0.06, H * 0.42, 0, matDark)
    part(W * 0.28, H * 0.1, D * 0.7, -W * 0.16, H * 0.47, D * 0.1, matLight)
    part(W * 0.28, H * 0.1, D * 0.7, W * 0.16, H * 0.47, D * 0.1, matLight)
  } else if (name === '床') {
    // 床架 + 床垫 + 床头板 + 两个枕头
    part(W, H * 0.32, D, 0, H * 0.16, 0, matBase)
    part(W * 0.94, H * 0.28, D * 0.92, 0, H * 0.42, D * 0.02, matLight)
    part(W, H * 0.7, D * 0.1, 0, H * 0.35, -D / 2 + D * 0.05, matDark)
    part(W * 0.34, H * 0.16, D * 0.16, -W * 0.22, H * 0.62, -D / 2 + D * 0.24, matLight)
    part(W * 0.34, H * 0.16, D * 0.16, W * 0.22, H * 0.62, -D / 2 + D * 0.24, matLight)
  } else if (name === '餐桌') {
    // 桌面 + 四条桌腿
    part(W, H * 0.12, D, 0, H * 0.94, 0, matBase)
    const legW = W * 0.07
    const legD = D * 0.09
    part(legW, H * 0.88, legD, -W / 2 + W * 0.1, H * 0.44, -D / 2 + D * 0.1, matDark)
    part(legW, H * 0.88, legD, W / 2 - W * 0.1, H * 0.44, -D / 2 + D * 0.1, matDark)
    part(legW, H * 0.88, legD, -W / 2 + W * 0.1, H * 0.44, D / 2 - D * 0.1, matDark)
    part(legW, H * 0.88, legD, W / 2 - W * 0.1, H * 0.44, D / 2 - D * 0.1, matDark)
  } else if (name === '柜子') {
    // 柜体 + 两扇门板 + 拉手
    part(W, H, D, 0, H / 2, 0, matBase)
    part(W * 0.46, H * 0.9, D * 0.05, -W * 0.24, H * 0.5, D / 2, matLight)
    part(W * 0.46, H * 0.9, D * 0.05, W * 0.24, H * 0.5, D / 2, matLight)
    part(W * 0.04, H * 0.12, D * 0.06, -W * 0.04, H * 0.5, D / 2, matDark)
    part(W * 0.04, H * 0.12, D * 0.06, W * 0.04, H * 0.5, D / 2, matDark)
  } else {
    part(W, H, D, 0, H / 2, 0, matBase)
  }

  group.position.set(toWorld(furniture.position.x), 0, toWorld(furniture.position.y))
  group.rotation.y = -THREE.MathUtils.degToRad(furniture.rotation)
  sceneRoot.add(group)
}

function addOpeningPanels(opening: PlanDocument['openings'][number], wall: PlanDocument['walls'][number]) {
  if (!sceneRoot) return
  const highlighted = isSelected('opening', opening.id)
  const { angle } = wallDirection(wall)
  const mid = wallPoint(wall, opening.offset + opening.width / 2)
  const width = toWorld(opening.width)
  const height = toWorld(opening.height)
  const thickness = toWorld(wall.thickness)
  const group = new THREE.Group()
  group.position.set(mid.x, 0, mid.z)
  group.rotation.y = angle
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(w, 0.0001), Math.max(h, 0.0001), Math.max(d, 0.0001)),
      material,
    )
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  if (opening.type === 'window') {
    const sill = toWorld(opening.sillHeight)
    const glass = highlightMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x9fd3e0,
        transparent: true,
        opacity: 0.4,
        roughness: 0.08,
        metalness: 0.1,
      }),
      highlighted,
    )
    const frame = highlightMaterial(
      new THREE.MeshStandardMaterial({ color: 0x6f8a95, roughness: 0.6, metalness: 0.3 }),
      highlighted,
    )
    const bar = toWorld(6)
    part(width * 0.92, height, thickness * 0.16, 0, sill + height / 2, 0, glass)
    part(width, bar, thickness * 0.4, 0, sill + height - bar / 2, 0, frame)
    part(width, bar, thickness * 0.4, 0, sill + bar / 2, 0, frame)
    part(bar, height, thickness * 0.4, -width / 2 + bar / 2, sill + height / 2, 0, frame)
    part(bar, height, thickness * 0.4, width / 2 - bar / 2, sill + height / 2, 0, frame)
  } else {
    const wood = highlightMaterial(
      new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.72, metalness: 0.04 }),
      highlighted,
    )
    const handle = highlightMaterial(
      new THREE.MeshStandardMaterial({ color: 0xd8c39b, roughness: 0.35, metalness: 0.55 }),
      highlighted,
    )
    part(width * 0.94, height, thickness * 0.18, 0, height / 2, 0, wood)
    part(toWorld(5), toWorld(5), toWorld(8), width * 0.36, height * 0.5, thickness * 0.16, handle)
  }
  sceneRoot.add(group)
}

function bounds() {
  const box = new THREE.Box3()
  if (sceneRoot && sceneRoot.children.length) box.setFromObject(sceneRoot)
  else box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(8, 3, 8))
  return box
}

/** 依据当前场景包围盒摆放地面并重新配置主光阴影，保证阴影范围始终覆盖整间房。 */
function refreshLighting() {
  const box = bounds()
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z, 4)
  if (keyLight) {
    keyLight.position.set(center.x + radius * 1.1, center.y + radius * 2.6, center.z + radius * 1.6)
    keyLight.target.position.copy(center)
    keyLight.target.updateMatrixWorld()
    const shadowCamera = keyLight.shadow.camera
    shadowCamera.left = -radius * 2.2
    shadowCamera.right = radius * 2.2
    shadowCamera.top = radius * 2.2
    shadowCamera.bottom = -radius * 2.2
    shadowCamera.near = 0.1
    shadowCamera.far = radius * 12
    shadowCamera.updateProjectionMatrix()
  }
  if (ground) {
    ground.scale.setScalar(radius * 12)
    ground.position.set(center.x, -0.01, center.z)
  }
}

function fitCamera() {
  if (!camera || !controls) return
  const box = bounds()
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z, 4)
  const distance = radius * 2
  camera.position.set(center.x + distance * 0.62, center.y + distance * 0.95, center.z + distance * 0.62)
  camera.near = Math.max(0.01, radius / 200)
  camera.far = Math.max(200, radius * 40)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.minDistance = Math.max(0.5, radius * 0.12)
  controls.maxDistance = radius * 12
  controls.maxPolarAngle = Math.PI / 2 - 0.03
  controls.update()
  refreshLighting()
}

function rebuildScene() {
  if (!sceneRoot) return
  clearSceneRoot()
  props.document.rooms.forEach(addRoom)
  props.document.walls.forEach(addWall)
  props.document.furniture.forEach(addFurniture)
  if (!hasInitialFit) {
    fitCamera()
    hasInitialFit = true
  } else {
    refreshLighting()
  }
}

function resize() {
  if (!host.value || !renderer || !camera) return
  const width = Math.max(1, host.value.clientWidth)
  const height = Math.max(1, host.value.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function animate() {
  if (!renderer || !scene || !camera) return
  controls?.update()
  renderer.render(scene, camera)
  animationFrame = requestAnimationFrame(animate)
}

onMounted(async () => {
  await nextTick()
  if (!host.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color(themeBackground())
  scene.fog = new THREE.Fog(themeBackground(), 40, 120)
  camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // 更接近真实软阴影的观感
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  host.value.appendChild(renderer.domElement)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 1
  controls.maxPolarAngle = Math.PI / 2 - 0.03

  // 柔和的环境光 + 一盏投影主光 + 一盏冷色补光
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7f77, 0.85))
  scene.add(new THREE.AmbientLight(0xffffff, 0.25))
  keyLight = new THREE.DirectionalLight(0xfff3e2, 2.5)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.bias = -0.0004
  keyLight.shadow.normalBias = 0.02
  scene.add(keyLight)
  scene.add(keyLight.target)
  const fillLight = new THREE.DirectionalLight(0xd8e6ff, 0.5)
  fillLight.position.set(-8, 6, -6)
  scene.add(fillLight)

  // 地面：承接阴影，让模型有落地感
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: groundColor(), roughness: 1, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.01
  ground.receiveShadow = true
  scene.add(ground)

  sceneRoot = new THREE.Group()
  scene.add(sceneRoot)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host.value)
  resize()
  rebuildScene()
  animate()
})

watch(
  () => props.document,
  () => rebuildScene(),
  { deep: true },
)

// 2D 选中对象变化时重建高亮（不重置相机取景）。
watch(
  () => props.selection,
  () => rebuildScene(),
  { deep: true },
)

watch(mode, () => {
  if (!scene) return
  const color = new THREE.Color(themeBackground())
  scene.background = color
  scene.fog = new THREE.Fog(color, 40, 120)
  if (ground && ground.material instanceof THREE.MeshStandardMaterial) ground.material.color.setHex(groundColor())
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  controls?.dispose()
  clearSceneRoot()
  if (ground) {
    ground.geometry.dispose()
    disposeMaterial(ground.material)
    ground = undefined
  }
  renderer?.dispose()
  renderer?.domElement.remove()
  scene = undefined
  camera = undefined
  renderer = undefined
  controls = undefined
  sceneRoot = undefined
  keyLight = undefined
})

/** 导出当前 3D 预览为 PNG。 */
function exportPng(filename = '设计方案') {
  if (!renderer || !scene || !camera) return
  renderer.render(scene, camera)
  const dataUrl = renderer.domElement.toDataURL('image/png')
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `${filename}-3D.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

defineExpose({ exportPng })
</script>

<template>
  <div ref="host" class="three-preview" aria-label="3D 只读预览">
    <div class="three-preview-badge">
      3D 只读预览 · {{ document.walls.length }} 面墙 · {{ document.furniture.length }} 件家具
    </div>
  </div>
</template>
