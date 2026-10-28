//! GLSL ES 3.00 shaders converting RGB to packed I420 planes.
//!
//! Every output texel holds four consecutive samples of one plane, so the
//! readback of an RGBA8 target is byte-for-byte the plane in I420 layout.

/// Full-screen triangle without vertex buffers.
pub const VERTEX: &str = r#"#version 300 es
void main() {
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
"#;

const FRAGMENT_BODY: &str = r#"
precision highp float;
uniform SAMPLER u_texture;
uniform vec2 u_src_origin;
uniform vec2 u_src_size;
uniform vec2 u_out_size;
uniform int u_plane;
out vec4 o_color;

vec3 rgb_at(vec2 luma_position) {
    return texture(u_texture, u_src_origin + luma_position / u_out_size * u_src_size).rgb;
}

void main() {
    vec2 texel = floor(gl_FragCoord.xy);
    vec4 packed_samples;
    for (int i = 0; i < 4; i++) {
        float column = texel.x * 4.0 + float(i);
        if (u_plane == 0) {
            vec3 c = rgb_at(vec2(column + 0.5, texel.y + 0.5));
            packed_samples[i] = (16.0 + 65.481 * c.r + 128.553 * c.g + 24.966 * c.b) / 255.0;
        } else {
            vec3 c = rgb_at(vec2(column * 2.0 + 1.0, texel.y * 2.0 + 1.0));
            packed_samples[i] = u_plane == 1
                ? (128.0 - 37.797 * c.r - 74.203 * c.g + 112.0 * c.b) / 255.0
                : (128.0 + 112.0 * c.r - 93.786 * c.g - 18.214 * c.b) / 255.0;
        }
    }
    o_color = packed_samples;
}
"#;

/// Fragment shader sampling an imported DMA-BUF (`samplerExternalOES`).
pub fn fragment_external() -> String {
    format!(
        "#version 300 es\n#extension GL_OES_EGL_image_external_essl3 : require\n{}",
        FRAGMENT_BODY.replace("SAMPLER", "samplerExternalOES")
    )
}

/// Fragment shader sampling a regular 2D texture.
pub fn fragment_2d() -> String {
    format!("#version 300 es\n{}", FRAGMENT_BODY.replace("SAMPLER", "sampler2D"))
}
