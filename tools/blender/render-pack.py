# Renders a rigged character into the frames the game needs.
#
#   blender -b -noaudio --python tools/blender/render-pack.py -- \
#       --blend tools/blender/demo_hero.blend --out build/demo3d --size 192
#
# Three views (front, right, back) times nine columns. Each column is one action
# and one frame, so a real character only has to bring actions named col0..col8
# (or a mapping json, see --map).
#
# The output is one PNG per view and column at --size pixels (192 by default,
# four times 48, so the assembler can downscale with clean edges).

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=192)
    parser.add_argument("--samples", type=int, default=16)
    parser.add_argument("--map", help="optional json: column -> [action, frame]")
    return parser.parse_args(argv)


def main():
    args = parse_args()
    bpy.ops.wm.open_mainfile(filepath=args.blend)
    scene = bpy.context.scene

    rig = next((obj for obj in bpy.data.objects if obj.type == "ARMATURE"), None)
    if rig is None:
        raise SystemExit("no armature in the blend file")

    # Lights: one sun plus a soft world, so the flat colours stay readable.
    if not any(obj.type == "LIGHT" for obj in bpy.data.objects):
        lamp_data = bpy.data.lights.new("key", "SUN")
        lamp_data.energy = 3.0
        lamp_data.angle = math.radians(12)
        lamp = bpy.data.objects.new("key", lamp_data)
        lamp.rotation_euler = (math.radians(55), 0, math.radians(25))
        bpy.context.collection.objects.link(lamp)

        fill_data = bpy.data.lights.new("fill", "SUN")
        fill_data.energy = 1.2
        fill = bpy.data.objects.new("fill", fill_data)
        fill.rotation_euler = (math.radians(60), 0, math.radians(210))
        bpy.context.collection.objects.link(fill)

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.55, 0.6, 0.7, 1.0)
        background.inputs["Strength"].default_value = 0.3

    # Fit the camera to the skinned meshes (the character, not the weapon), so
    # a different model only needs its own blend file, no numbers.
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    found = False
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if not any(m.type == "ARMATURE" and m.object is rig for m in obj.modifiers):
            continue
        found = True
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                lo[axis] = min(lo[axis], point[axis])
                hi[axis] = max(hi[axis], point[axis])

    if found:
        height = hi[2] - lo[2]
        width = hi[0] - lo[0]
        centre_z = (hi[2] + lo[2]) / 2
    else:
        height, width, centre_z = 2.2, 1.0, 1.0
    print(f"fit: height {height:.2f}, width {width:.2f}, centre z {centre_z:.2f}")

    target = bpy.data.objects.new("look_at", None)
    bpy.context.collection.objects.link(target)
    target.location = (0, 0, centre_z)

    camera_data = bpy.data.cameras.new("shot")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(height, width) * 1.06
    camera = bpy.data.objects.new("shot", camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera

    track = camera.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = False
    scene.cycles.device = "CPU"
    scene.render.film_transparent = True
    scene.render.resolution_x = args.size
    scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # Standard, not AgX: crisp saturated colours instead of a washed film look.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    mapping = None
    if args.map:
        with open(args.map, "r", encoding="utf8") as handle:
            mapping = json.load(handle)

    # 0 = front (facing the camera), 1 = right, 2 = back.
    views = [
        (0, (0, -6, 1.05)),
        (1, (-6, 0, 1.05)),
        (2, (0, 6, 1.05)),
    ]

    os.makedirs(args.out, exist_ok=True)
    for view, position in views:
        camera.location = position
        for column in range(9):
            entry = mapping.get(str(column)) if mapping else None
            action_name = entry[0] if entry else f"col{column}"
            frame = int(entry[1]) if entry else 1

            action = bpy.data.actions.get(action_name)
            if action is None:
                raise SystemExit(f"missing action {action_name} for column {column}")

            rig.animation_data_create()
            rig.animation_data.action = action
            scene.frame_set(frame)

            scene.render.filepath = os.path.join(args.out, f"v{view}_c{column}.png")
            bpy.ops.render.render(write_still=True)
            print(f"rendered view {view} column {column} ({action_name} @ {frame})")

    print(f"done: {args.out}")


if __name__ == "__main__":
    main()
