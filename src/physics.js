// AABB vs voxel collision.
import { SOLID, BLOCKS, B } from './blocks.js';

// entity: {x,y,z (feet center), vx,vy,vz, w, h, onGround}
export function collides(world, x0, y0, z0, x1, y1, z1) {
  for (let y = Math.floor(y0); y <= Math.floor(y1 - 1e-6); y++)
    for (let z = Math.floor(z0); z <= Math.floor(z1 - 1e-6); z++)
      for (let x = Math.floor(x0); x <= Math.floor(x1 - 1e-6); x++) {
        const b = world.getBlock(x, y, z);
        if (SOLID[b]) {
          // partial height blocks
          const shape = BLOCKS[b].shape;
          if (shape === 'bed' && y0 >= y + 9 / 16 - 1e-4) continue;
          if (shape === 'flat' && y0 >= y + 15 / 16 - 1e-4) continue;
          return true;
        }
        if (!world.isLoaded(x, z)) return true;
      }
  return false;
}

function boxAt(e, x, y, z) {
  const hw = e.w / 2;
  return [x - hw, y, z - hw, x + hw, y + e.h, z + hw];
}

export function moveEntity(world, e, dt) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(e.vx), Math.abs(e.vy), Math.abs(e.vz)) * dt / 0.3));
  const sdt = dt / steps;
  e.hitWall = false;
  e.onGround = false;
  for (let s = 0; s < steps; s++) {
    // Y
    let ny = e.y + e.vy * sdt;
    let b = boxAt(e, e.x, ny, e.z);
    if (collides(world, ...b)) {
      if (e.vy < 0) {
        e.onGround = true;
        const target = ny;
        ny = e.y;
        for (let k = 0; k < 10; k++) {
          const t = (ny + target) / 2;
          if (!collides(world, ...boxAt(e, e.x, t, e.z))) ny = t; else break;
        }
      } else ny = e.y;
      e.vy = 0;
    }
    e.y = ny;
    // X
    let nx = e.x + e.vx * sdt;
    if (collides(world, ...boxAt(e, nx, e.y, e.z))) {
      e.hitWall = true; e.vx = 0;
    } else e.x = nx;
    // Z
    let nz = e.z + e.vz * sdt;
    if (collides(world, ...boxAt(e, e.x, e.y, nz))) {
      e.hitWall = true; e.vz = 0;
    } else e.z = nz;
  }
  // ground check when resting
  if (!e.onGround && e.vy <= 0 && collides(world, ...boxAt(e, e.x, e.y - 0.02, e.z))) e.onGround = true;
}

export function inBlock(world, e, id, yOff = 0) {
  return world.getBlock(Math.floor(e.x), Math.floor(e.y + yOff), Math.floor(e.z)) === id;
}

export function isInLiquid(world, e) {
  const hw = e.w / 2 - 0.01;
  for (const yo of [0.1, e.h * 0.5]) {
    for (const [dx, dz] of [[-hw, -hw], [hw, hw], [0, 0]]) {
      const b = world.getBlock(Math.floor(e.x + dx), Math.floor(e.y + yo), Math.floor(e.z + dz));
      if (b === B.water) return 'water';
      if (b === B.lava) return 'lava';
    }
  }
  return null;
}

// Voxel raycast (Amanatides & Woo). Returns {x,y,z, face:[nx,ny,nz], id, dist}
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, filter) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
  const tDeltaX = Math.abs(1 / dx), tDeltaY = Math.abs(1 / dy), tDeltaZ = Math.abs(1 / dz);
  let tMaxX = dx > 0 ? (x + 1 - ox) * tDeltaX : (ox - x) * tDeltaX;
  let tMaxY = dy > 0 ? (y + 1 - oy) * tDeltaY : (oy - y) * tDeltaY;
  let tMaxZ = dz > 0 ? (z + 1 - oz) * tDeltaZ : (oz - z) * tDeltaZ;
  if (!isFinite(tMaxX)) tMaxX = Infinity;
  if (!isFinite(tMaxY)) tMaxY = Infinity;
  if (!isFinite(tMaxZ)) tMaxZ = Infinity;
  let face = [0, 0, 0], t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id && (filter ? filter(id) : true)) return { x, y, z, face, id, dist: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0]; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0]; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ]; }
  }
  return null;
}

// ray vs AABB, returns distance or -1
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [minX, minY, minZ], mx = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return -1; continue; }
    let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : -1);
}
