

export interface IProjectile {
  id: string;
  x: number;      // FIXED: Was 'startX'
  y: number;      // FIXED: Was 'startY'
  angle: number; 
  speed: number; 
  spawnTime: number; 
  lifespan: number; 
  color: string;
}

export enum PatternType {
  SINGLE = 'SINGLE',
  SHOTGUN = 'SHOTGUN',
  SPIRAL = 'SPIRAL',
  NOVA = 'NOVA'
}

export class ProjectileSystem {
  
  static getProjectilesAtTime(
    pattern: PatternType, 
    origin: {x: number, y: number}, 
    startTime: number, 
    currentTime: number,
    baseAngle: number
  ): IProjectile[] {
    
    const elapsed = (currentTime - startTime) / 1000;
    if (elapsed < 0) return [];

    const bullets: IProjectile[] = [];
    const speed = 10; 
    const range = 2.0; 

    if (elapsed > range) return [];

    const dist = speed * elapsed;

    // Helper to create projectile
    const makeProj = (id: string, a: number, c: string): IProjectile => ({
        id,
        x: origin.x + Math.cos(a) * dist,
        y: origin.y + Math.sin(a) * dist,
        angle: a,
        speed,
        spawnTime: startTime,
        lifespan: range,
        color: c
    });

    switch (pattern) {
      case PatternType.SINGLE:
        bullets.push(makeProj('p_0', baseAngle, 'yellow'));
        break;

      case PatternType.SHOTGUN:
        [-0.25, 0, 0.25].forEach((offset, idx) => {
          bullets.push(makeProj(`p_${idx}`, baseAngle + offset, 'red'));
        });
        break;

      case PatternType.NOVA:
        for(let i=0; i<8; i++) {
          bullets.push(makeProj(`p_${i}`, baseAngle + (i * (Math.PI / 4)), 'cyan'));
        }
        break;
    }

    return bullets;
  }
  
  // --- NEW: COLLISION/DEFLECTION LOGIC ---
  static checkDeflection(bullet: IProjectile, swingOrigin: {x: number, y: number}, swingAngle: number): boolean {
      // Simple check: Is bullet within swing range (2.0) and within arc?
      const dx = bullet.x - swingOrigin.x;
      const dy = bullet.y - swingOrigin.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist > 2.0) return false;

      const angleToBullet = Math.atan2(dy, dx);
      const angleDiff = Math.abs(angleToBullet - swingAngle);
      
      // 0.75 rad is roughly 45 degrees
      return angleDiff < 0.75; 
  }
}