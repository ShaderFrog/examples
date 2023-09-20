import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as core from '@shaderfrog/core';
import { generate } from '@shaderfrog/glsl-parser';
import { engine, createMaterial } from '@shaderfrog/core/dist/plugins/three';

// TODO: Try putting graph here
console.log({ core, engine });
let id = 0;
const makeId = () => `id_${id++}`;

const outFrom = (node) => node.outputs[0].name;
const edgeFrom = (fromNode, toId, input, type) =>
  core.makeEdge(makeId(), fromNode.id, toId, outFrom(fromNode), input, type);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x222222);
document.body.appendChild(renderer.domElement);

const pointLight = new THREE.PointLight(0xffffff, 1);
pointLight.position.set(1, 0, 1);
const helper = new THREE.PointLightHelper(pointLight, 0.1);
scene.add(pointLight);
scene.add(helper);

const geometry = new THREE.TorusKnotGeometry(0.6, 0.25, 200, 32);
const mesh = new THREE.Mesh(geometry);
scene.add(mesh);

camera.position.z = 2;

const controls = new OrbitControls(camera, renderer.domElement);

const ctx = {
  engine: 'three',
  // TODO: Rename runtime to "engine" and make a new nodes and data top level
  // key cache (if we keep the material cache) and type it in the graph
  runtime: {
    three: THREE,
    renderer,
    sceneData: {
      lights: [],
      helpers: [],
      mesh: mesh,
    },
    scene,
    camera,
    index: 0,
    cache: { data: {}, nodes: {} },
  },
  nodes: {},
  debuggingNonsense: {},
};

const outputF = core.outputNode(
  makeId(),
  'Output',
  { x: 434, y: -97 },
  'fragment'
);
const outputV = core.outputNode(
  makeId(),
  'Output',
  { x: 434, y: 20 },
  'vertex'
);

const physicalGroupId = makeId();
const physicalF = engine.constructors.physical(
  makeId(),
  'Physical',
  physicalGroupId,
  { x: 178, y: -103 },
  [],
  'fragment'
);
const physicalV = engine.constructors.physical(
  makeId(),
  'Physical',
  physicalGroupId,
  { x: 434, y: 130 },
  [],
  'vertex',
  physicalF.id
);

const graph = {
  nodes: [outputF, outputV, physicalF, physicalV],
  edges: [
    edgeFrom(physicalF, outputF.id, 'filler_frogFragOut', 'fragment'),
    edgeFrom(physicalV, outputV.id, 'filler_gl_Position', 'vertex'),
  ],
};

core.compileSource(graph, engine, ctx).then((compileResult) => {
  console.log(
    'compile result',
    compileResult,
    'isWebgl2',
    renderer.capabilities.isWebGL2
  );

  const material = createMaterial(compileResult, ctx);

  const {
    sceneData: { mesh },
    engineMaterial,
  } = ctx.runtime;

  material.uniforms = { ...material.uniforms, ...{} };
  material.roughness = 0;

  console.log('🏞 Re-creating three.js material!', {
    material,
    uniforms: material.uniforms,
    engineMaterial: ctx.runtime.engineMaterial,
  });

  mesh.material = material;
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  mesh.rotation.x += 0.01;
  mesh.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();
