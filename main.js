let camera, scene, renderer;
let particles;
let mouseX = 0, mouseY = 0;
const particleCount = 500000;
const MAX_PULSES = 10;  // Maximum number of simultaneous pulses
let pulses = [];  // Initialize pulses array

// Add power-up tracking variables at the top
let holdStartTime = 0;
const MAX_POWER = 3.0;  // Maximum power multiplier
const POWER_RATE = 0.5;  // How fast the power builds up

init();
animate();

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000);
    document.body.appendChild(renderer.domElement);

    // Custom shader material
    const particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            mousePos: { value: new THREE.Vector2(0, 0) },
            resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
            distortionStrength: { value: 0.5 },
            pulses: { value: new Float32Array(MAX_PULSES * 3) },  // x: time, y: centerX, z: centerY
            pulseCount: { value: 0 },
            isAttracting: { value: false },
            attractTransition: { value: 0.0 },
            attractPower: { value: 1.0 }  // Base power level
        },
        vertexShader: `
            uniform float time;
            uniform vec2 mousePos;
            uniform vec2 resolution;
            uniform vec3 pulses[${MAX_PULSES}];  // Array of pulse data
            uniform int pulseCount;
            uniform bool isAttracting;
            uniform float attractTransition;
            uniform float attractPower;
            
            varying vec2 vUv;
            varying float vDistance;

            vec3 mod289(vec3 x) {
                return x - floor(x * (1.0 / 289.0)) * 289.0;
            }

            vec4 mod289(vec4 x) {
                return x - floor(x * (1.0 / 289.0)) * 289.0;
            }

            vec4 permute(vec4 x) {
                return mod289(((x*34.0)+1.0)*x);
            }

            vec4 taylorInvSqrt(vec4 r) {
                return 1.79284291400159 - 0.85373472095314 * r;
            }

            float snoise(vec3 v) { 
                const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

                // First corner
                vec3 i  = floor(v + dot(v, C.yyy));
                vec3 x0 = v - i + dot(i, C.xxx);

                // Other corners
                vec3 g = step(x0.yzx, x0.xyz);
                vec3 l = 1.0 - g;
                vec3 i1 = min(g.xyz, l.zxy);
                vec3 i2 = max(g.xyz, l.zxy);

                vec3 x1 = x0 - i1 + C.xxx;
                vec3 x2 = x0 - i2 + C.yyy;
                vec3 x3 = x0 - D.yyy;

                // Permutations
                i = mod289(i); 
                vec4 p = permute(permute(permute( 
                    vec4(i.z, i1.z, i2.z, 1.0 ))
                    + vec4(i.y, i1.y, i2.y, 1.0 )) 
                    + vec4(i.x, i1.x, i2.x, 1.0 ));

                // Gradients: 7x7 points over a square, mapped onto an octahedron.
                // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
                float n_ = 0.142857142857;
                vec3 ns = n_ * D.wyz - D.xzx;

                vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

                vec4 x_ = floor(j * ns.z);
                vec4 y_ = floor(j - 7.0 * x_);

                vec4 x = x_ *ns.x + ns.yyyy;
                vec4 y = y_ *ns.x + ns.yyyy;
                vec4 h = 1.0 - abs(x) - abs(y);

                vec4 b0 = vec4(x.xy, y.xy);
                vec4 b1 = vec4(x.zw, y.zw);

                vec4 s0 = floor(b0)*2.0 + 1.0;
                vec4 s1 = floor(b1)*2.0 + 1.0;
                vec4 sh = -step(h, vec4(0.0));

                vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
                vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

                vec3 p0 = vec3(a0.xy, h.x);
                vec3 p1 = vec3(a0.zw, h.y);
                vec3 p2 = vec3(a1.xy, h.z);
                vec3 p3 = vec3(a1.zw, h.w);

                // Normalise gradients
                vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
                p0 *= norm.x;
                p1 *= norm.y;
                p2 *= norm.z;
                p3 *= norm.w;

                // Mix final noise value
                vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                m = m * m;
                return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
            }

            void main() {
                // Add organic movement
                vec3 pos = position;
                float noiseScale = 0.5;
                float noiseTime = time * 0.5;
                vec3 noisePos = pos * noiseScale;
                
                pos += vec3(
                    snoise(noisePos + vec3(noiseTime, 0.0, 0.0)),
                    snoise(noisePos + vec3(0.0, noiseTime, 0.0)),
                    snoise(noisePos + vec3(0.0, 0.0, noiseTime))
                ) * 0.5;

                // Project position and calculate screen coordinates
                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                vec4 projectedPos = projectionMatrix * mvPosition;
                vec2 screenPos = projectedPos.xy / projectedPos.w;
                
                vUv = screenPos * 0.5 + 0.5;
                
                // Apply all active pulses
                for(int i = 0; i < ${MAX_PULSES}; i++) {
                    if(i >= pulseCount) break;
                    
                    vec2 pulseCenter = pulses[i].yz;
                    float pulseTime = pulses[i].x;
                    float dist = distance(screenPos, pulseCenter);
                    
                    float pulseRadius = pulseTime * 1.0;
                    float ringWidth = 0.15;
                    float pulseFade = 1.0 - smoothstep(0.0, 2.0, pulseTime);
                    float ringEffect = smoothstep(pulseRadius - ringWidth, pulseRadius, dist) 
                                     * (1.0 - smoothstep(pulseRadius, pulseRadius + ringWidth, dist))
                                     * pulseFade;
                    
                    if (ringEffect > 0.0) {
                        vec2 direction = normalize(screenPos - pulseCenter);
                        pos.xy += direction * ringEffect * 1.0;
                    }
                }
                
                // Normal hover/attract effect
                float dist = distance(screenPos, mousePos);
                float repelRadius = 0.3;
                float repelStrength = 1.0;
                float attractStrength = 0.8;
                
                if (dist < repelRadius) {
                    vec2 direction = normalize(screenPos - mousePos);
                    float effect = (1.0 - dist/repelRadius);
                    if (isAttracting) {
                        pos.xy -= direction * effect * mix(0.0, attractStrength * attractPower, attractTransition);
                    } else {
                        pos.xy += direction * effect * mix(repelStrength, 0.0, attractTransition);
                    }
                }
                
                vDistance = dist / repelRadius;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = 2.0;
            }
        `,
        fragmentShader: `
            uniform vec2 resolution;
            uniform float distortionStrength;
            varying float vDistance;
            varying vec2 vUv;

            vec2 barrel(vec2 uv, float strength) {
                vec2 coord = (uv - 0.5) * 2.0;
                float radius = length(coord);
                float distortion = 1.0 + radius * radius * strength;
                return coord * distortion * 0.5 + 0.5;
            }

            void main() {
                // Sharper color transition
                float hoverEffect = 1.0 - smoothstep(0.0, 0.8, vDistance);
                
                // Default white color
                vec3 baseColor = vec3(1.0, 1.0, 1.0);
                // Hot red color for hover
                vec3 hoverColor = vec3(1.0, 0.2, 0.1);
                
                // Mix between base and hover color with sharper transition
                vec3 color = mix(baseColor, hoverColor, pow(hoverEffect, 2.0));
                
                // Edge fade based on distance from center
                float edgeFade = 1.0 - pow(length((vUv - 0.5) * 2.0), 2.0);
                color *= edgeFade;

                // Chromatic aberration at edges
                float distFromCenter = length(vUv - 0.5) * 2.0;
                float aberrationStrength = 0.1 * distFromCenter;
                
                vec3 finalColor;
                finalColor.r = color.r * (1.0 + aberrationStrength);
                finalColor.g = color.g;
                finalColor.b = color.b * (1.0 - aberrationStrength);

                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        transparent: true
    });

    // Create particle geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 2;
        positions[i + 1] = (Math.random() - 0.5) * 2;
        positions[i + 2] = (Math.random() - 0.5) * 100;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles = new THREE.Points(geometry, particleMaterial);
    scene.add(particles);

    // Mouse move event listener
    document.addEventListener('mousemove', (event) => {
        // Convert mouse coordinates to normalized device coordinates (-1 to +1)
        mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
        particles.material.uniforms.mousePos.value.set(mouseX, mouseY);
    });

    // Add window resize handler
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        particles.material.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    });
}

// Add click handler and pulse animation
let pulseAnimation = null;
let isMouseDown = false;
let holdTimer = null;
let isDragging = false;
let mouseDownTime = 0;
const DRAG_THRESHOLD = 200; // ms to consider it a drag vs click

document.addEventListener('mousedown', (event) => {
    isMouseDown = true;
    mouseDownTime = Date.now();
    holdStartTime = Date.now();  // Track when we started holding
    
    // Convert mouse coordinates
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    particles.material.uniforms.mousePos.value.set(mouseX, mouseY);
    
    // Immediately start attract mode, transition will be handled in animation
    particles.material.uniforms.isAttracting.value = true;
    particles.material.uniforms.attractTransition.value = 0.0;
});

document.addEventListener('mousemove', (event) => {
    if (isMouseDown && !isDragging) {
        // If mouse has been held and moved, consider it a drag
        if (Date.now() - mouseDownTime > DRAG_THRESHOLD) {
            isDragging = true;
        }
    }
    
    // Update mouse position
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    particles.material.uniforms.mousePos.value.set(mouseX, mouseY);
});

document.addEventListener('mouseup', (event) => {
    // Trigger pulse if it was a quick click or if we were dragging
    if (!isDragging || (isDragging && isMouseDown)) {
        // Add new pulse
        if (pulses.length < MAX_PULSES) {
            pulses.push({
                time: 0,
                x: mouseX,
                y: mouseY
            });
            // Update uniform
            updatePulsesUniform();
        }
    }
    
    // Reset states
    isMouseDown = false;
    isDragging = false;
    particles.material.uniforms.isAttracting.value = false;
    particles.material.uniforms.attractTransition.value = 0.0;
});

// Add function to update pulses uniform
function updatePulsesUniform() {
    const pulseData = new Float32Array(MAX_PULSES * 3);
    pulses.forEach((pulse, i) => {
        pulseData[i * 3] = pulse.time;
        pulseData[i * 3 + 1] = pulse.x;
        pulseData[i * 3 + 2] = pulse.y;
    });
    particles.material.uniforms.pulses.value = pulseData;
    particles.material.uniforms.pulseCount.value = pulses.length;
}

// Update the animate function
function animate() {
    requestAnimationFrame(animate);
    particles.material.uniforms.time.value += 0.01;
    
    // Update all pulses
    pulses.forEach(pulse => {
        pulse.time += 0.01;
    });
    
    // Remove finished pulses
    pulses = pulses.filter(pulse => pulse.time <= 2.0);
    
    // Update uniforms
    updatePulsesUniform();
    
    // Update attract transition and power
    if (particles.material.uniforms.isAttracting.value) {
        particles.material.uniforms.attractTransition.value = Math.min(
            particles.material.uniforms.attractTransition.value + 0.05,
            1.0
        );
        
        // Calculate power based on hold duration
        const holdDuration = (Date.now() - holdStartTime) / 1000;  // Convert to seconds
        const power = Math.min(1.0 + (holdDuration * POWER_RATE), MAX_POWER);
        particles.material.uniforms.attractPower.value = power;
    } else {
        particles.material.uniforms.attractTransition.value = Math.max(
            particles.material.uniforms.attractTransition.value - 0.05,
            0.0
        );
        particles.material.uniforms.attractPower.value = 1.0;  // Reset power when released
    }
    
    renderer.render(scene, camera);
} 