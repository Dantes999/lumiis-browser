# Builds a renderable .blend from a KayKit character plus its animations.
#
#   blender -b -noaudio --python tools/blender/build-kaykit-hero.py -- \
#       --character ~/Downloads/kaykit_adventurers/Characters/gltf/Knight.glb \
#       --animations ~/Downloads/kaykit_adventurers/Animations/gltf/Rig_Medium \
#       --weapon ~/Downloads/kaykit_adventurers/Assets/gltf/sword_1handed.gltf \
#       --out tools/blender/knight.blend
#
# The character brings the mesh and the skeleton; the animation files bring the
# actions (idle, walk, hit, death, ...). The free pack has no attack animation,
# so three swing poses are keyed here on top of the idle pose.
#
# Then: tools/blender/render-pack.py with --map columns.json (the file this
# script writes next to the .blend).

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--character", required=True)
    parser.add_argument("--animations", required=True, help="folder with Rig_Medium_*.glb")
    parser.add_argument("--weapon")
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def main():
    args = parse_args()
    out = Path(args.out)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    bpy.ops.import_scene.gltf(filepath=str(Path(args.character).expanduser()))
    rig = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")

    # The pack ships a stray Icosphere with the character; drop anything that is
    # not skinned to the rig.
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        skinned = any(
            modifier.type == "ARMATURE" and modifier.object is rig for modifier in obj.modifiers
        )
        if not skinned:
            bpy.data.objects.remove(obj, do_unlink=True)

    # Import the animations and keep only their actions.
    for glb in sorted(Path(args.animations).expanduser().glob("*.glb")):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(glb))
        for action in bpy.data.actions:
            action.use_fake_user = True
        for obj in list(bpy.data.objects):
            if obj not in before:
                bpy.data.objects.remove(obj, do_unlink=True)

    # A weapon, rigidly attached to the right hand slot.
    if args.weapon:
        bpy.ops.import_scene.gltf(filepath=str(Path(args.weapon).expanduser()))
        sword = next(
            (obj for obj in bpy.data.objects if obj.type == "MESH" and "sword" in obj.name.lower()),
            None,
        )
        if sword is not None:
            sword.parent = rig
            sword.parent_type = "BONE"
            sword.parent_bone = "handslot.r"
            sword.matrix_parent_inverse = Matrix.Identity(4)
            # The blade is +Z in the mesh; turn it along the hand bone (Y) and
            # slide it so the grip, not the middle, sits in the hand.
            sword.rotation_euler = (math.radians(-90), 0, 0)
            sword.location = (0, 0.45, 0)

    # The importer suffixes action names when its own rig collides with ours
    # (".001"), so look them up by prefix.
    def action_by_prefix(prefix):
        for action in bpy.data.actions:
            if action.name.startswith(prefix):
                return action
        raise SystemExit(f"{prefix} missing")

    # Three swing poses on top of the idle pose (the free pack has no attacks).
    rig.animation_data_create()
    idle = action_by_prefix("Idle_A_Rig_Medium")
    rig.animation_data.action = idle
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()

    def swing(name, deltas):
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        rig.animation_data.action = action
        for pose_bone in rig.pose.bones:
            pose_bone.rotation_mode = "QUATERNION"
        for bone_name, degrees in deltas.items():
            pose_bone = rig.pose.bones.get(bone_name)
            if pose_bone is None:
                continue
            turn = Euler(
                (
                    math.radians(degrees[0]),
                    math.radians(degrees[1]),
                    math.radians(degrees[2]),
                ),
                "XYZ",
            ).to_quaternion()
            pose_bone.rotation_quaternion = pose_bone.rotation_quaternion @ turn
        for pose_bone in rig.pose.bones:
            pose_bone.keyframe_insert("rotation_quaternion", frame=1)
            pose_bone.keyframe_insert("location", frame=1)
            pose_bone.keyframe_insert("scale", frame=1)

    # Wind-up, strike, follow-through. Angles are in the bone's local space.
    swing("atk_windup", {"upperarm.r": (-70, 0, 0), "lowerarm.r": (-40, 0, 0), "chest": (0, 14, 0)})
    swing("atk_strike", {"upperarm.r": (45, 0, 0), "lowerarm.r": (15, 0, 0), "chest": (0, -16, 0)})
    swing("atk_recover", {"upperarm.r": (15, 0, 0), "chest": (0, -4, 0)})

    rig.animation_data.action = idle

    bpy.ops.wm.save_as_mainfile(filepath=str(out))

    # The render script needs to know which action and frame fill each column.
    mapping = {
        "0": [action_by_prefix("Idle_A_Rig_Medium").name, 0],
        "1": [action_by_prefix("Walking_A_Rig_Medium").name, 3],
        "2": [action_by_prefix("Walking_A_Rig_Medium").name, 16],
        "3": [action_by_prefix("Idle_A_Rig_Medium").name, 12],
        "4": ["atk_windup", 1],
        "5": ["atk_strike", 1],
        "6": ["atk_recover", 1],
        "7": [action_by_prefix("Hit_A_Rig_Medium").name, 8],
        "8": [action_by_prefix("Death_A_Rig_Medium").name, 18],
    }
    map_path = out.with_suffix(".columns.json")
    import json

    map_path.write_text(json.dumps(mapping, indent=2), encoding="utf8")

    print(f"saved {out}")
    print(f"saved {map_path}")
    print("actions:", ", ".join(sorted(a.name for a in bpy.data.actions)))


if __name__ == "__main__":
    main()
