# Builds a small rigged demo hero in Blender and saves it as a .blend.
#
#   blender -b -noaudio --python tools/blender/build-demo-hero.py -- \
#       --out tools/blender/demo_hero.blend
#
# The figure is a chibi made of simple parts, each rigidly bound to one bone
# (a 3D paper doll). That is enough to prove the render pipeline: three views,
# nine columns. A real character later replaces this mesh; the render script
# only needs an armature with the actions col0..col8.

import argparse
import math
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def make_material(name, color, roughness=0.75, metallic=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return material


def add_box(name, size, location, material, bone):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(material)
    obj["bone"] = bone
    return obj


def add_sphere(name, scale, location, material, bone):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(material)
    obj["bone"] = bone
    return obj


def main():
    args = parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    skin = make_material("skin", (0.93, 0.76, 0.6))
    hair = make_material("hair", (0.1, 0.09, 0.1))
    cloth = make_material("armor", (0.6, 0.15, 0.11))
    gold = make_material("gold", (0.85, 0.65, 0.25), roughness=0.35, metallic=0.8)
    pants = make_material("pants", (0.18, 0.22, 0.3))
    boots = make_material("boots", (0.28, 0.19, 0.13))
    steel = make_material("steel", (0.72, 0.76, 0.82), roughness=0.25, metallic=0.9)
    eye = make_material("eye", (0.08, 0.08, 0.09), roughness=0.4)

    parts = []

    # Body (the character faces -Y, which is the camera's front view).
    parts.append(add_box("pelvis", (0.46, 0.34, 0.24), (0, 0, 0.94), cloth, "hips"))
    parts.append(add_box("torso", (0.5, 0.36, 0.4), (0, 0, 1.2), cloth, "spine"))
    parts.append(add_box("belt", (0.52, 0.32, 0.08), (0, 0, 1.0), gold, "spine"))
    parts.append(add_box("shoulder_l", (0.2, 0.28, 0.16), (0.3, 0, 1.36), gold, "spine"))
    parts.append(add_box("shoulder_r", (0.2, 0.28, 0.16), (-0.3, 0, 1.36), gold, "spine"))

    # Head, hair, eyes.
    parts.append(add_sphere("head", (0.29, 0.32, 0.3), (0, 0, 1.68), skin, "head"))
    parts.append(add_sphere("hair", (0.31, 0.34, 0.28), (0, 0.02, 1.76), hair, "head"))
    parts.append(add_box("fringe", (0.5, 0.2, 0.12), (0, -0.18, 1.76), hair, "head"))
    parts.append(add_sphere("eye_l", (0.045, 0.03, 0.06), (0.1, -0.26, 1.68), eye, "head"))
    parts.append(add_sphere("eye_r", (0.045, 0.03, 0.06), (-0.1, -0.26, 1.68), eye, "head"))

    # Arms.
    parts.append(add_box("upper_arm_l", (0.15, 0.16, 0.28), (0.36, 0, 1.2), skin, "arm_l"))
    parts.append(add_box("forearm_l", (0.14, 0.15, 0.26), (0.36, 0, 0.98), cloth, "arm_l"))
    parts.append(add_box("hand_l", (0.13, 0.14, 0.12), (0.36, 0, 0.82), skin, "arm_l"))
    parts.append(add_box("upper_arm_r", (0.15, 0.16, 0.28), (-0.36, 0, 1.2), skin, "arm_r"))
    parts.append(add_box("forearm_r", (0.14, 0.15, 0.26), (-0.36, 0, 0.98), cloth, "arm_r"))
    parts.append(add_box("hand_r", (0.13, 0.14, 0.12), (-0.36, 0, 0.82), skin, "arm_r"))

    # Legs and boots.
    parts.append(add_box("leg_l", (0.17, 0.18, 0.5), (0.13, 0, 0.5), pants, "leg_l"))
    parts.append(add_box("leg_r", (0.17, 0.18, 0.5), (-0.13, 0, 0.5), pants, "leg_r"))
    parts.append(add_box("boot_l", (0.19, 0.26, 0.16), (0.13, -0.04, 0.14), boots, "leg_l"))
    parts.append(add_box("boot_r", (0.19, 0.26, 0.16), (-0.13, -0.04, 0.14), boots, "leg_r"))

    # Sword in the left hand (screen right), pointing up.
    parts.append(add_box("blade", (0.06, 0.03, 0.62), (0.36, -0.06, 1.3), steel, "weapon"))
    parts.append(add_box("guard", (0.2, 0.06, 0.05), (0.36, -0.06, 0.99), gold, "weapon"))
    parts.append(add_box("grip", (0.05, 0.05, 0.18), (0.36, -0.06, 0.9), boots, "weapon"))

    # Armature.
    armature = bpy.data.armatures.new("hero_rig")
    rig = bpy.data.objects.new("hero_rig", armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")

    def bone(name, head, tail, parent=None):
        edit_bone = armature.edit_bones.new(name)
        edit_bone.head = head
        edit_bone.tail = tail
        if parent is not None:
            edit_bone.parent = armature.edit_bones[parent]
            edit_bone.use_connect = False
        return edit_bone

    bone("hips", (0, 0, 0.82), (0, 0, 1.0))
    bone("spine", (0, 0, 1.0), (0, 0, 1.45), "hips")
    bone("head", (0, 0, 1.45), (0, 0, 1.95), "spine")
    bone("arm_l", (0.3, 0, 1.36), (0.36, 0, 0.82), "spine")
    bone("arm_r", (-0.3, 0, 1.36), (-0.36, 0, 0.82), "spine")
    bone("leg_l", (0.13, 0, 0.8), (0.13, 0, 0.06), "hips")
    bone("leg_r", (-0.13, 0, 0.8), (-0.13, 0, 0.06), "hips")
    bone("weapon", (0.36, 0, 0.82), (0.36, 0, 1.5), "arm_l")

    bpy.ops.object.mode_set(mode="OBJECT")

    # Bind each part rigidly to its bone.
    for part in parts:
        group = part.vertex_groups.new(name=part["bone"])
        group.add(list(range(len(part.data.vertices))), 1.0, "REPLACE")
        modifier = part.modifiers.new("armature", "ARMATURE")
        modifier.object = rig
        part.parent = rig
        part.matrix_parent_inverse = rig.matrix_world.inverted()

    # Poses: one action per column. A real model brings its own actions; the
    # render script only needs col0..col8.
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"

    rig.animation_data_create()

    def action(name, rotations):
        created = bpy.data.actions.new(name)
        # Keep the action even while another one is being edited; otherwise it
        # is dropped on save because nothing references it any more.
        created.use_fake_user = True
        rig.animation_data.action = created
        for pose_bone in rig.pose.bones:
            pose_bone.rotation_euler = (0, 0, 0)
            pose_bone.location = (0, 0, 0)
        for bone_name, euler in rotations.items():
            pose_bone = rig.pose.bones.get(bone_name)
            if pose_bone is not None:
                pose_bone.rotation_euler = euler
        for pose_bone in rig.pose.bones:
            pose_bone.keyframe_insert("rotation_euler", frame=1)
            pose_bone.keyframe_insert("location", frame=1)

    r = math.radians
    action("col0", {})  # stand
    action("col1", {"leg_l": (r(26), 0, 0), "leg_r": (r(-26), 0, 0), "arm_l": (r(-22), 0, 0), "arm_r": (r(22), 0, 0)})
    action("col2", {"leg_l": (r(-26), 0, 0), "leg_r": (r(26), 0, 0), "arm_l": (r(22), 0, 0), "arm_r": (r(-22), 0, 0)})
    action("col3", {"arm_l": (0, 0, r(-6)), "arm_r": (0, 0, r(6))})  # breathe
    action("col4", {"arm_l": (r(-105), 0, r(20)), "spine": (r(-8), 0, r(-8))})  # wind-up
    action("col5", {"arm_l": (r(65), 0, r(-25)), "spine": (r(10), 0, r(12))})  # strike
    action("col6", {"arm_l": (r(18), 0, r(-10)), "spine": (r(2), 0, r(4))})  # follow-through
    action("col7", {"spine": (r(-14), 0, 0), "head": (r(-12), 0, 0), "arm_l": (r(-20), 0, 0)})  # hit
    action("col8", {"hips": (r(55), 0, 0), "spine": (r(20), 0, 0), "leg_l": (r(-60), 0, 0), "leg_r": (r(-60), 0, 0)})  # down

    rig.animation_data.action = bpy.data.actions["col0"]
    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.wm.save_as_mainfile(filepath=args.out)
    print(f"saved {args.out}")


if __name__ == "__main__":
    main()
