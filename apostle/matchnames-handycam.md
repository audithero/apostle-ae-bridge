# HandyCam property matchNames (captured Phase 0, Gate B)

Environment: AE 26.2.1 (2026), macOS, HandyCam effect matchName `PEHC`, 452 effects installed.
Captured 2026-07-27 by applying `PEHC` to a clean 3D null (`HC_RIG` in probe comp `__APOSTLE_HC_PROBE__`) and walking the effect property tree via the bridge. Tree captured pre-Setup; the plugin defines its parameter list at apply time, so matchNames are stable. Display names may be localized; always address properties by matchName.

⚠️ **License note**: the panel reports "HandyCam is unregistered, some features are disabled" on this machine (trial/unlicensed). Factor into the Phase 3 A/B decision.

## Scripting-relevant properties

| Purpose | matchName | Display name |
|---|---|---|
| Effect root | `PEHC` | HandyCam |
| **Orbit** group | `PEHC-0001` | Orbit |
| Orbit X | `PEHC-0002` | X |
| Orbit Y | `PEHC-0003` | Y |
| Orbit Z | `PEHC-0004` | Z |
| Cam orients controller | `PEHC-0049` | Cam Orients Controller |
| Orbit order | `PEHC-0006` | Order (under Advanced `PEHC-0005`) |
| Look At mode | `PEHC-0009` | Look At |
| Look At target | `PEHC-0010` | Target |
| Look At offset | `PEHC-0011` | Offset |
| **Local Transform** group | `PEHC-0050` | Local Transform |
| Truck (local X) | `PEHC-0051` | X (Truck) |
| Pedestal (local Y) | `PEHC-0052` | Y (Pedestal) |
| Dolly (local Z) | `PEHC-0012` | Z (Dolly) |
| **Position Offset** group | `PEHC-0014` | Position Offset |
| Position Offset X | `PEHC-0015` | X |
| Position Offset Y | `PEHC-0016` | Y |
| Position Offset Z | `PEHC-0017` | Z |
| **Lens** group | `PEHC-0019` | Lens |
| DoF enable | `PEHC-0021` | Enable |
| Aperture | `PEHC-0022` | Aperture |
| Blur | `PEHC-0023` | Blur |
| Blur quality | `PEHC-0048` | Blur Quality |
| Focus distance | `PEHC-0024` | Focus Distance |
| Focus offset | `PEHC-0025` | Focus Offset |
| Focus layer | `PEHC-0026` | Focus Layer |
| Focal length (mm) | `PEHC-0028` | Focal Length (mm) |
| Dolly zoom | `PEHC-0029` | Dolly Zoom |
| **Wiggle** group | `PEHC-0031` | Wiggle |
| Wiggle frequency | `PEHC-0034` | Frequency |
| Wiggle amplitude (handheld) | `PEHC-0033` | Amplitude Handheld |
| Wiggle amplitude (focus) | `PEHC-1034` | Amplitude Focus |
| **Utility** group | `PEHC-0036` | Utility |
| Source camera (layer ref) | `PEHC-0042` | Source Camera |
| Source camera int | `PEHC-0059` | Source Camera Int |
| Frame edges | `PEHC-0043..0046` | Left / Top / Right / Bottom |
| Initialised (NOT a Setup flag — stays 0 after Setup) | `PEHC-0047` | Initialised |

Unnamed indices (`PEHC-0007/0008/0013/0018/0027/0030/0035/0037..0041/0053..0058`) are separators/hidden params — do not touch. `PEHC-0054/0056` carry the unregistered-license warning text.

## Usage rules (from the build brief, Section 8)

1. Apply `PEHC` to a clean null with NO transform keyframes.
2. Human clicks **Setup** once (compiled-effect button, unscriptable). Verified post-Setup behavior (AE 26.2.1, HandyCam on this machine): the null is **renamed** to `HandyCam_Controller_1`, a `HandyCam_Camera_1` camera layer is created with expressions on Anchor Point / Position / Z Rotation (all evaluate clean), and `PEHC-0059` (Source Camera Int) is set to the camera's layer ID. **Programmatic "has Setup been clicked" check: `PEHC-0059` ≠ 0.** (`PEHC-0047` "Initialised" stays 0 — do not use it.) Scripts must not assume the null keeps its pre-Setup name.
3. Keyframe ONLY effect properties (Position Offset / Local Transform / Orbit above). Null raw Transform = static rig relocation only.
4. Never keyframe the null's Transform.Position — double-transforms the rig.

## Position Offset is shake-scale, NOT transport (Phase 3 A/B finding)

The Setup-generated camera expressions bake the look-at target as controller + [0, 0, 2666.7] (or the Look At target layer if one is assigned). Keyframing Position Offset over corridor-scale distances translates the camera while the target stays pinned near the rig home — measured at a 3200 px station move: camera z lands exactly on the target plane, PoI stays at the home plane (camera faces backward; renders blank/off-by-one). Small offsets (tens of px) frame correctly. The expressions are obfuscated compiled-plugin output — do not attempt to patch them. Consequence: HandyCam is unusable for autonomous station transport; expression rig is the pipeline default.
