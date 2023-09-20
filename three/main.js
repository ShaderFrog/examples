import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as core from '@shaderfrog/core';
import { generate } from '@shaderfrog/glsl-parser';
import { engine } from '@shaderfrog/core/dist/plugins/three';

// TODO: Try putting graph here
console.log({ core, engine });
let id = 0;
const makeId = () => `id_${id++}`;

const outFrom = (node) => node.outputs[0].name;
const edgeFrom = (fromNode, toId, input, type) =>
  core.makeEdge(makeId(), fromNode.id, toId, outFrom(fromNode), input, type);

const compile = async (ctx, graph) => {
  await core.computeGraphContext(ctx, engine, graph);
  const result = core.compileGraph(ctx, engine, graph);

  const fragmentResult = generate(
    core.shaderSectionsToProgram(result.fragment, engine.mergeOptions).program
  );
  const vertexResult = generate(
    core.shaderSectionsToProgram(result.vertex, engine.mergeOptions).program
  );

  const dataInputs = core.filterGraphNodes(
    graph,
    [result.outputFrag, result.outputVert],
    { input: core.isDataInput }
  ).inputs;

  // Find which nodes flow up into uniform inputs, for colorizing and for
  // not recompiling when their data changes
  const dataNodes = Object.entries(dataInputs).reduce(
    (acc, [nodeId, inputs]) => {
      return inputs.reduce((iAcc, input) => {
        const fromEdge = graph.edges.find(
          (edge) => edge.to === nodeId && edge.input === input.id
        );
        const fromNode =
          fromEdge && graph.nodes.find((node) => node.id === fromEdge.from);
        return fromNode
          ? {
              ...iAcc,
              ...core.collectConnectedNodes(graph, fromNode),
            }
          : iAcc;
      }, acc);
    },
    {}
  );

  return { vertexResult, fragmentResult, dataNodes };
};

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

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

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
      mesh: cube,
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

compile(ctx, graph).then((compileResult) => {
  console.log(
    'compile result',
    compileResult,
    'isWebgl2',
    renderer.capabilities.isWebGL2
  );

  const {
    sceneData: { mesh },
    engineMaterial,
  } = ctx.runtime;

  // Note this is setting the uniforms of the shader at creation time. The
  // uniforms are also updated every frame in the useThree() loop.
  const { uniforms, properties } = Object.entries(
    compileResult.dataInputs || {}
  ).reduce(
    ({ uniforms, properties }, [nodeId, inputs]) => {
      const node = ensure(graph.nodes.find(({ id }) => id === nodeId));
      const updatedUniforms = {};
      const updatedProperties = {};

      inputs.forEach((input) => {
        const edge = graph.edges.find(
          ({ to, input: i }) => to === nodeId && i === input.id
        );
        if (edge) {
          const fromNode = ensure(
            graph.nodes.find(({ id }) => id === edge.from)
          );
          // THIS DUPLICATE OTHER LINE
          let value;
          try {
            value = core.evaluateNode(threngine, graph, fromNode);
          } catch (err) {
            console.warn('Tried to evaluate a non-data node!', {
              err,
              dataInputs: compileResult.dataInputs,
            });
            return;
          }
          let newValue = value;
          if (fromNode.type === 'texture') {
            // THIS DUPLICATES OTHER LINE
            // This is instantiation of initial shader
            newValue = textures[fromNode.value];
          } else if (fromNode.type === 'samplerCube') {
            newValue = textures[fromNode.value];
          }
          // TODO: This doesn't work for engine variables because
          // those aren't suffixed
          const name = core.mangleVar(input.displayName, threngine, node);

          if (input.property) {
            updatedProperties[name] = newValue;
          } else {
            updatedUniforms[name] = { value: newValue };
          }
        }
      });
      return {
        uniforms: { ...uniforms, ...updatedUniforms },
        properties: { ...properties, ...updatedProperties },
      };
    },
    {
      uniforms: {},
      properties: {},
    }
  );

  const finalUniforms = {
    ...THREE.ShaderLib.phong.uniforms,
    ...THREE.ShaderLib.toon.uniforms,
    ...THREE.ShaderLib.physical.uniforms,
    ...uniforms,
    time: { value: 0 },
  };

  const initialProperties = {
    name: 'ShaderFrog Material',
    lights: true,
    uniforms: {
      ...finalUniforms,
    },
    transparent: true,
    opacity: 1.0,
    glslVersion: '300 es',
    vertexShader: compileResult?.vertexResult.replace('#version 300 es', ''),
    fragmentShader: compileResult?.fragmentResult.replace(
      '#version 300 es',
      ''
    ),
  };

  const additionalProperties = Object.entries({
    ...engineMaterial,
    ...properties,
  })
    .filter(
      ([property]) =>
        // Ignore three material "hidden" properties
        property.charAt(0) !== '_' &&
        // Ignore uuid since it should probably be unique?
        property !== 'uuid' &&
        // I'm not sure what three does with type under the hood, ignore it
        property !== 'type' &&
        // "precision" adds a precision preprocessor line
        property !== 'precision' &&
        // Ignore existing properties
        !(property in initialProperties) &&
        // Ignore STANDARD and PHYSICAL defines to the top of the shader in
        // WebGLProgram
        // https://github.com/mrdoob/three.js/blob/e7042de7c1a2c70e38654a04b6fd97d9c978e781/src/renderers/webgl/WebGLProgram.js#L392
        // which occurs if we set isMeshPhysicalMaterial/isMeshStandardMaterial
        property !== 'defines'
    )
    .reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: value,
      }),
      {}
    );

  const newMat = new THREE.RawShaderMaterial(initialProperties);

  // This prevents a deluge of warnings from three on the constructor saying
  // that each of these properties is not a property of the material
  Object.entries(additionalProperties).forEach(([key, value]) => {
    newMat[key] = value;
  });

  console.log('🏞 Re-creating three.js material!', {
    newMat,
    uniforms,
    properties,
    finalUniforms,
    engineMaterial: ctx.runtime.engineMaterial,
  });

  mesh.material = newMat;
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();
