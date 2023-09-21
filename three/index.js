import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as core from '@shaderfrog/core';
import { generate } from '@shaderfrog/glsl-parser';
import { engine, createMaterial } from '@shaderfrog/core/dist/plugins/three';

/**
 * Standard Three.js setup
 */
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

// const geometry = new THREE.TorusKnotGeometry(0.6, 0.25, 200, 32);
const geometry = new THREE.BoxGeometry(1, 1, 1, 32, 32, 32);
const mesh = new THREE.Mesh(geometry);
scene.add(mesh);

camera.position.z = 2;

const controls = new OrbitControls(camera, renderer.domElement);

function animate(time) {
  requestAnimationFrame(animate);
  controls.update();
  mesh.rotation.x += 0.005;
  mesh.rotation.y += 0.005;

  const uniform = mesh.material?.uniforms?.[`start_${fId}`];
  if (uniform) {
    uniform.value = new THREE.Vector2(
      -0.2307 + 0.05 * Math.sin(time * 0.001),
      0.6923 + 0.05 * Math.cos(time * 0.001)
    );
  }
  renderer.render(scene, camera);
}
animate();

/**
 * Helper functions
 */
let id = 0;
const makeId = () => `id_${id++}`;

const outFrom = (node) => node.outputs[0].name;
const edgeFrom = (fromNode, toId, input, type) =>
  core.makeEdge(makeId(), fromNode.id, toId, outFrom(fromNode), input, type);

/**
 * Build the initial scene "context" to pass to the compiler
 */
const ctx = {
  engine: 'three',
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

/**
 * Build the foundations of the graph
 */
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

/**
 * Build the Three.js MeshPhysicalMaterial graph node
 */
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

/**
 * Create the Julia shader nodes
 */
const makeJuliaF = (id) =>
  core.sourceNode(
    id,
    'Julia',
    {},
    {
      version: 2,
      preprocess: true,
      strategies: [core.uniformStrategy()],
    },
    `precision highp float;
precision highp int;

uniform vec2 start;
uniform int iter;
uniform vec3 fractal_color;
uniform float time;
varying vec2 vUv;

void main() {
    vec2 z;
    z.x = 3.0 * (vUv.x - .5);
    z.y = 3.0 * (vUv.y - .5);
    
    int y = 0;
    for (int i = 0; i < 100; i++) {
        y++;
        float x = (z.x * z.x - z.y * z.y) + start.x;
        float y = (z.x * z.y + z.x * z.y) + start.y;
        
        if ((x * x + y * y) > 10.0) {
            break;
        }
        z.x = x;
        z.y = y;
    }
    
    float val = (float(y) / float(iter)) * 0.25;
    gl_FragColor = vec4(0.5 + val, 0.5 - val, 1.0, 1.0);
}
`,
    'fragment',
    'three'
  );

const makeJuliaV = (id, nextStageNodeId) =>
  core.sourceNode(
    id,
    'Julia',
    {},
    {
      version: 2,
      preprocess: true,
      strategies: [core.uniformStrategy()],
      uniforms: [],
    },
    `precision highp float;
    precision highp int;
    
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    varying vec2 vUv;
    
    attribute vec3 position;
    attribute vec2 uv;
    
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
    'vertex',
    'three',
    nextStageNodeId
  );

const fId = makeId();
const juliaF = makeJuliaF(fId);
const juliaV = makeJuliaV(makeId(), fId);

/**
 * Build the graph
 */
const graph = {
  nodes: [juliaF, juliaV, physicalF, physicalV, outputF, outputV],
  edges: [
    edgeFrom(juliaF, physicalF.id, 'property_normalMap', 'fragment'),
    edgeFrom(physicalF, outputF.id, 'filler_frogFragOut', 'fragment'),
    edgeFrom(physicalV, outputV.id, 'filler_gl_Position', 'vertex'),
  ],
};

/**
 * Compile the graph to GLSL
 */
core.compileSource(graph, engine, ctx).then((compileResult) => {
  /**
   * Convert the compiled GLSL to a RawShaderMaterial
   */
  const material = createMaterial(compileResult, ctx);

  material.uniforms = {
    ...material.uniforms,
    ...{
      [`start_${fId}`]: { value: new THREE.Vector2(-0.2307, 0.6923) },
      [`iter_${fId}`]: { value: 8 },
      [`fractal_color_${fId}`]: { value: new THREE.Color(0.0, 0.9, 0.1) },
    },
  };
  material.roughness = 0;

  console.log('🏞 Re-created Three.js material!', {
    material,
    compileResult,
  });

  mesh.material = material;

  document.getElementById('fragment').value = compileResult.fragmentResult;
  document.getElementById('vertex').value = compileResult.vertexResult;
});
