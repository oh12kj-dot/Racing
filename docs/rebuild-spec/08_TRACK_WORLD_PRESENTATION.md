# 08 — Track, World and Presentation

## 1. Track data model

Track logic must be independent from decorative mesh construction.

Authoritative track data should expose:

- closed-loop arc length / progress `s`;
- world-space center/reference spline;
- tangent/normal/heading;
- curvature;
- left/right usable widths;
- surface type/grip;
- kerb/runoff boundaries;
- barrier/collision boundaries;
- sectors/start-finish;
- pit entry/exit geometry;
- pit lanes/boxes;
- optional elevation/banking where supported.

World-to-track and track-to-world transforms should be stable and testable.

## 2. Track geometry quality

The circuit must look and behave like a real racing facility.

Requirements:

- no accidental course self-overlap/intersection;
- no duplicated road slabs occupying the same space;
- no objects/colliders placed on the racing surface unless intentionally part of the circuit;
- smooth road edge/runoff/grass boundaries;
- consistent lane width;
- sensible corner radii and transitions;
- barriers positioned with believable runoff/clearance;
- pit entry/exit physically connected to the circuit.

If a visual crossing is intended, elevation/bridge separation must make it unambiguous.

## 3. Driveable corridor

Track width is a physical input to racecraft.

The system should expose a usable corridor reduced by vehicle/clearance margins. Overtaking decisions must use that corridor rather than a single centerline.

The ideal racing line is only a reference inside the corridor.

## 4. Racing line

The rebuild may generate or store one or more reference lines:

- optimal/normal;
- wet/alternative;
- pit approach/merge;
- special configuration lines.

Line generation must not imply that cars are kinematically attached to the line.

## 5. Pit/world alignment

Garage openings, team pit boxes, working lane and fast lane must align visually and logically.

No decorative pit-wall object, prop or building collider may block the authorized pit path.

## 6. World collision geometry

There must be one authoritative set of physical barriers/colliders.

Do not build an obsolete barrier set and later hide/dispose/rebuild it as normal architecture. The clean build constructs only the final world representation required by the selected quality tier.

Visual and collision geometry may differ in complexity, but not in meaningful placement.

## 7. Assets

Retain source assets separately from generated/runtime artifacts.

Suggested categories:

- source vehicle models/textures;
- source track/environment models;
- liveries/material inputs;
- audio source;
- logos/icons/fonts with documented licensing;
- generated/compressed runtime assets.

Every non-generated asset should have origin/license metadata.

The application must have an explicit policy for optional assets. A missing optional GLB or remote resource must degrade gracefully rather than prevent simulation boot.

## 8. Rendering

Rendering is downstream of simulation.

Target qualities include:

- physically plausible materials;
- vehicle grounding/contact shadows;
- stable reflections;
- readable road surface/rubber/braking traces;
- weather/time variation;
- headlights/taillights where applicable;
- rain/wet-road presentation where supported;
- scalable scene complexity.

Photorealism work must not introduce hidden simulation dependencies.

## 9. Mobile rendering policy

On iPhone/mobile, prefer:

1. correct geometry/materials;
2. stable vehicle grounding;
3. useful shadows/reflections;
4. readable road/environment detail;
5. temporal stability;
6. only then expensive post effects.

Quality adaptation may reduce decorative complexity, shadow/reflection cost, update cadence and render resolution. It must not change racing logic.

## 10. Camera system

Required spectator camera families:

- broadcast trackside;
- follow/pan;
- onboard/driver-facing spectator cameras;
- pit/garage;
- wide establishing shots;
- optional battle picture-in-picture.

Camera behaviour should use real broadcast conventions: lead room, stable horizon where appropriate, predictable cuts, sensible focal behaviour and avoidance of constant frantic switching.

## 11. Broadcast director

The director observes race events and chooses what to show.

Useful inputs:

- close battles;
- overtaking attempts/completions;
- incidents;
- pit stops;
- leader/important class battles;
- race-control events;
- final laps/finish.

The director cannot change the event it is observing.

## 12. UI

UI should provide information without covering the race unnecessarily.

Core surfaces:

- race start/watch controls;
- timing tower/classification;
- lap/session state;
- gap/interval;
- class/vehicle identification;
- pit/flag state;
- camera controls;
- settings/performance controls;
- map/radar/telemetry where useful;
- diagnostics in developer/test mode.

Mobile controls must be touch-safe and actually clickable on iPhone Safari/WebKit.

## 13. Audio

Audio categories:

- engine/powertrain;
- tyre/contact/impact;
- environment/crowd where used;
- pit effects;
- radio;
- UI.

Mixer controls should be stable and persistent where appropriate. Audio events observe simulation state rather than mutate it.

## 14. Weather/environment

If weather is enabled, it may affect both presentation and simulation through an explicit environment state:

- wetness/grip;
- visibility;
- tyre choice/performance;
- spray/reflection visuals;
- sky/light state.

Presentation reads the same environment state; it does not invent a separate visual weather truth.

## 15. Regression requirements

- no track or pit object intrudes into authorised driving corridors;
- grass/runoff edge does not visibly sawtooth across road;
- physical barrier matches visible location within defined tolerance;
- missing optional asset does not block boot;
- iPhone buttons/camera controls respond to touch;
- runtime renders non-empty frame;
- camera switching does not pause/alter simulation;
- quality settings do not alter race results for the same deterministic simulation inputs;
- pit buildings/boxes and service positions align.