import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * GSAP and ScrollTrigger in a chunk of their own: main.ts imports it before `chapters.ts`,
 * so the two module graphs are evaluated in separate tasks (each a few ms) instead of one.
 */
gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };
