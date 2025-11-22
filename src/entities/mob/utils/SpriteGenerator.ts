import { MobSize } from '../types';

export class SpriteGenerator {
  
  /**
   * Generates a Base64 Sprite Sheet for a given mob.
   * The sheet will be 8 frames horizontally (0-7), representing 8 directions.
   * 0: South, 1: SW, 2: West, 3: NW, 4: North, 5: NE, 6: East, 7: SE
   */
  static generateBlobSprite(color: string, size: MobSize): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Base size per frame
    let frameSize = 32;
    switch (size) {
      case MobSize.TINY: frameSize = 16; break;
      case MobSize.MEDIUM: frameSize = 32; break;
      case MobSize.LARGE: frameSize = 64; break;
      case MobSize.GIGANTIC: frameSize = 128; break;
      case MobSize.COLOSSAL: frameSize = 256; break;
    }

    // Sheet Dimensions: 8 Frames x 1 Row
    canvas.width = frameSize * 8;
    canvas.height = frameSize;

    // Draw 8 Directions
    for (let i = 0; i < 8; i++) {
      const offsetX = i * frameSize;
      const centerX = offsetX + frameSize / 2;
      const centerY = frameSize / 2;
      const radius = (frameSize / 2) - 2;

      // 1. Body (The Blob)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
      
      // Highlight (Pseudo-3D)
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(centerX - radius/3, centerY - radius/3, radius/3, 0, Math.PI * 2);
      ctx.fill();

      // 2. Eyes (Directional Indicator)
      // Calculate Eye Offset based on Direction Index (0-7)
      // 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE
      const angle = (i * 45 + 90) * (Math.PI / 180); // Offset to start at South
      const eyeDist = radius * 0.5;
      const eyeX = centerX + Math.cos(angle) * eyeDist;
      const eyeY = centerY + Math.sin(angle) * eyeDist;

      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, radius * 0.25, 0, Math.PI * 2);
      ctx.fill();
      
      // Pupil
      ctx.fillStyle = 'black';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, radius * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvas.toDataURL();
  }
}