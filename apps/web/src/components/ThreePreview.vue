<script setup lang="ts">
import type { PlanDocument } from '@home-design/plan-schema'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAssetsStore } from '../stores/assets'

const props = defineProps<{ document: PlanDocument }>()
const assets = useAssetsStore()

const host = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer | undefined
let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let controls: OrbitControls | undefined
let sceneRoot: THREE.Group | undefined
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

function wallMaterial(color = 0xe6e2d7) {
  return new THREE.MeshLambertMaterial({ color })
}

function addWallSegment(
  wall: PlanDocument['walls'][number],
  startOffset: number,
  endOffset: number,
  bottom: number,
  height: number,
) {
  if (!sceneRoot || endOffset - startOffset <= 0.01 || height <= 0.01) return
  const { angle } = wallDirection(wall)
  const start = wallPoint(wall, startOffset)
  const end = wallPoint(wall, endOffset)
  const center = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 }
  const geometry = new THREE.BoxGeometry(toWorld(endOffset - startOffset), toWorld(height), toWorld(wall.thickness))
  const mesh = new THREE.Mesh(geometry, wallMaterial())
  mesh.position.set(center.x, toWorld(bottom + height / 2), center.z)
  mesh.rotation.y = angle
  sceneRoot.add(mesh)
}

function addWall(wall: PlanDocument['walls'][number]) {
  const { length } = wallDirection(wall)
  const openings = props.document.openings
    .filter((opening) => opening.wallId === wall.id)
    .sort((a, b) => a.offset - b.offset)
  if (!openings.length) {
    addWallSegment(wall, 0, length, 0, wall.height)
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
      addWallSegment(wall, start, end, 0, wall.height)
      continue
    }
    if (opening.sillHeight > 0) addWallSegment(wall, start, end, 0, opening.sillHeight)
    const top = opening.sillHeight + opening.height
    if (top < wall.height) addWallSegment(wall, start, end, top, wall.height - top)
  }
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
    new THREE.MeshLambertMaterial({ color: 0xcabf9f, side: THREE.DoubleSide }),
  )
  mesh.rotation.x = -Math.PI / 2
  sceneRoot.add(mesh)
}

function addFurniture(furniture: PlanDocument['furniture'][number]) {
  if (!sceneRoot) return
  const asset = assets.getById(furniture.assetId)
  const color = asset?.color ? new THREE.Color(asset.color) : new THREE.Color('#9aa69d')
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(toWorld(furniture.width), toWorld(furniture.height), toWorld(furniture.depth)),
    new THREE.MeshLambertMaterial({ color }),
  )
  mesh.position.set(toWorld(furniture.position.x), toWorld(furniture.height / 2), toWorld(furniture.position.y))
  mesh.rotation.y = -THREE.MathUtils.degToRad(furniture.rotation)
  sceneRoot.add(mesh)
}

function bounds() {
  const box = new THREE.Box3()
  if (sceneRoot && sceneRoot.children.length) box.setFromObject(sceneRoot)
  else box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(8, 3, 8))
  return box
}

function fitCamera() {
  if (!camera || !controls) return
  const box = bounds()
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z, 4)
  camera.position.set(center.x + radius * 1.25, center.y + radius * 1.15, center.z + radius * 1.25)
  camera.near = Math.max(0.01, radius / 100)
  camera.far = Math.max(100, radius * 20)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.maxDistance = radius * 8
  controls.update()
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
  scene.background = new THREE.Color('#dfe7e4')
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.value.appendChild(renderer.domElement)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.minDistance = 1
  scene.add(new THREE.AmbientLight(0xffffff, 1.8))
  const directional = new THREE.DirectionalLight(0xffffff, 2.2)
  directional.position.set(5, 10, 7)
  scene.add(directional)
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

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  controls?.dispose()
  clearSceneRoot()
  renderer?.dispose()
  renderer?.domElement.remove()
  scene = undefined
  camera = undefined
  renderer = undefined
  controls = undefined
  sceneRoot = undefined
})
</script>

<template>
  <div ref="host" class="three-preview" aria-label="3D 只读预览">
    <div class="three-preview-badge">
      3D 只读预览 · {{ document.walls.length }} 面墙 · {{ document.furniture.length }} 件家具
    </div>
  </div>
</template>
