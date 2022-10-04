"use strict";

let KDEnemiesCache = new Map();

let KinkyDungeonSummonCount = 2;
let KinkyDungeonEnemyAlertRadius = 2;
let KDStealthyMult = 0.75;
let KDConspicuousMult = 1.5;

let commentChance = 0.03;
let actionDialogueChance = 0.1;
let actionDialogueChanceIntense = 0.4;


/**
 *
 * @param {number} x
 * @param {number} y
 * @param {string[]} [filter]
 * @param {boolean} [any]
 * @param {boolean} [qualified] - Exclude jails where the player doesnt meet conditions
 * @returns {{x: number, y: number, type: string, radius: number}}
 */
function KinkyDungeonNearestJailPoint(x, y, filter, any, qualified) {
	let filt = filter ? filter : ["jail"];
	let dist = 100000;
	let point = null;
	let leash = KinkyDungeonGetRestraintItem("ItemNeckRestraints");
	let furniture = KinkyDungeonGetRestraintItem("ItemDevices");
	for (let p of KDGameData.JailPoints) {
		if (!any && p.type && !filt.includes(p.type)) continue;
		if (qualified && p.requireLeash && !leash) continue;
		if (qualified && p.requireFurniture && !furniture) continue;
		let d = Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
		if (d < dist) {
			dist = d;
			point = p;
		}
	}

	return point;
}

function KDLockNearbyJailDoors(x, y) {
	let jail = KinkyDungeonNearestJailPoint(x, y);
	if (jail) {
		let radius = jail.radius + 1;
		if (radius)
			for (let X = x - Math.ceil(radius); X <= x + Math.ceil(radius); X++)
				for (let Y = y - Math.ceil(radius); Y <= y + Math.ceil(radius); Y++)
					if (KinkyDungeonTiles.get(X + ',' + Y)?.Jail && KinkyDungeonMapGet(X, Y) == 'd') {
						KinkyDungeonMapSet(X, Y, 'D');
						KinkyDungeonTiles.get(X + ',' + Y).Lock = "Red";
					}
	}
}

/**
 *
 * @param {string[]} [filter]
 * @param {{x: number, y: number, type: string, radius: number}[]} [exclude]
 * @returns {{x: number, y: number, type: string, radius: number}}
 */
function KinkyDungeonRandomJailPoint(filter, exclude) {
	let filt = filter ? filter : ["jail"];
	let points = [];
	for (let p of KDGameData.JailPoints) {
		if (p.type && !filt.includes(p.type)) continue;
		if (!exclude || exclude.includes(p)) continue;
		points.push(p);
	}
	if (points.length > 0) return points[Math.floor(KDRandom() * points.length)];
	return null;
}

function KinkyDungeonNearestPatrolPoint(x, y) {
	let dist = 100000;
	let point = -1;
	for (let p of KinkyDungeonPatrolPoints) {
		let d = Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
		if (d < dist) {
			dist = d;
			point = KinkyDungeonPatrolPoints.indexOf(p);
		}
	}

	return point;
}

/** @type {Map<string, number>} */
let KinkyDungeonFlags = new Map();

/**
 *
 * @param {string} Flag
 * @param {number} Duration - In turns
 * @param {number} [Floors] - Optional, makes this flag expire in this many floors
 */
function KinkyDungeonSetFlag(Flag, Duration, Floors) {
	if (!KinkyDungeonFlags.get(Flag) || Duration <= 0 || (KinkyDungeonFlags.get(Flag) > 0 && KinkyDungeonFlags.get(Flag) < Duration)) {
		KinkyDungeonFlags.set(Flag, Duration);
		if (Duration == 0) {
			KinkyDungeonFlags.delete(Flag);
		} else if (Floors != undefined) {
			if (!KDGameData.TempFlagFloorTicks)
				KDGameData.TempFlagFloorTicks = {};
			// handle optional floor count flag setting logic
			if (!KDGameData.TempFlagFloorTicks[Flag] || KDGameData.TempFlagFloorTicks[Flag] < Floors) {
				KDGameData.TempFlagFloorTicks[Flag] = Floors;
			}
			if (Floors === 0) {
				delete KDGameData.TempFlagFloorTicks[Flag];
			}
		}
	}
}

function KinkyDungeonUpdateFlags(delta) {
	for (let f of KinkyDungeonFlags.keys()) {
		if (KinkyDungeonFlags.get(f) != -1) {
			if (KinkyDungeonFlags.get(f) > 0) KinkyDungeonFlags.set(f, KinkyDungeonFlags.get(f) - delta);
			if (KinkyDungeonFlags.get(f) <= 0 && KinkyDungeonFlags.get(f) != -1) KinkyDungeonFlags.delete(f);
		}
	}
}

function KinkyDungeonGetPatrolPoint(index, radius, Tiles) {
	let p = KinkyDungeonPatrolPoints[index];
	let t = Tiles ? Tiles : KinkyDungeonMovableTilesEnemy;
	if (p) {
		for (let i = 0; i < 8; i++) {
			let XX = p.x + Math.round(KDRandom() * 2 * radius - radius);
			let YY = p.y + Math.round(KDRandom() * 2 * radius - radius);
			if (t.includes(KinkyDungeonMapGet(XX, YY))) {
				return {x: XX, y: YY};
			}
		}
	}
	return p;
}

function KDHelpless(enemy) {
	return enemy && (enemy.hp <= enemy.Enemy.maxhp * 0.1 || enemy.hp <= 0.52 || enemy.boundLevel > 10 * enemy.Enemy.maxhp) && KDBoundEffects(enemy) > 3;
}

function KinkyDungeonNearestPlayer(enemy, requireVision, decoy, visionRadius) {
	if (enemy && enemy.Enemy && !visionRadius) {
		visionRadius = enemy.Enemy.visionRadius;
		if (enemy.blind && !enemy.aware) visionRadius = 1.5;
	}
	if (decoy) {
		let pdist = Math.sqrt((KinkyDungeonPlayerEntity.x - enemy.x)*(KinkyDungeonPlayerEntity.x - enemy.x)
			+ (KinkyDungeonPlayerEntity.y - enemy.y)*(KinkyDungeonPlayerEntity.y - enemy.y));
		let nearestVisible = undefined;

		if (enemy.Enemy.focusPlayer && KinkyDungeonCheckLOS(enemy, KinkyDungeonPlayerEntity, pdist, visionRadius, false, false) && !KinkyDungeonCheckPath(enemy.x, enemy.y, KinkyDungeonPlayerEntity.x, KinkyDungeonPlayerEntity.y, false, true)) return KinkyDungeonPlayerEntity;

		let nearestDistance = KDHostile(enemy) ? pdist - 0.1 : 100000;

		if ((enemy.Enemy.visionRadius || enemy.Enemy.blindSight) && !(enemy.Enemy.noAttack && !enemy.Enemy.spells))
			for (let e of KinkyDungeonEntities) {
				if (e == enemy) continue;
				if (KDHelpless(e)) continue;
				if (enemy.Enemy.noTargetSilenced && e.silence > 0) continue;
				if ((e.Enemy && !e.Enemy.noAttack && KDHostile(enemy, e))) {
					let dist = Math.sqrt((e.x - enemy.x)*(e.x - enemy.x)
						+ (e.y - enemy.y)*(e.y - enemy.y));
					let pdist_enemy = (KDGetFaction(enemy) == "Player" && !KDEnemyHasFlag(enemy, "NoFollow") && !KDEnemyHasFlag(enemy, "StayHere") && (enemy.Enemy.allied || (!KDGameData.PrisonerState || KDGameData.PrisonerState == "chase")))
						? KDistChebyshev(e.x - KinkyDungeonPlayerEntity.x, e.y - KinkyDungeonPlayerEntity.y) :
						-1;
					if (pdist_enemy > 0 && pdist_enemy < 1.5 && KDHostile(e)) KinkyDungeonSetFlag("AIHelpPlayer", 4);
					if (pdist_enemy > 0 && KinkyDungeonFlags.get("AIHelpPlayer") && dist > 2.5) {
						if (pdist_enemy > 2.5) dist += 2;
						else dist = Math.max(1.01 + dist/4, dist/3);
					}
					if (dist <= nearestDistance && (pdist_enemy <= 0 ||
						((KinkyDungeonVisionGet(e.x, e.y) > 0 || pdist_enemy < 5) && (pdist_enemy < 8 || enemy.Enemy.followRange > 1))
					)) {
						if (KinkyDungeonCheckLOS(enemy, e, dist, visionRadius, true, true)) {
							if (enemy.rage || !e.Enemy.lowpriority
									|| (!KinkyDungeonCheckLOS(enemy, KinkyDungeonPlayerEntity, pdist, visionRadius, true, true) || !KinkyDungeonCheckPath(enemy.x, enemy.y, KinkyDungeonPlayerEntity.x, KinkyDungeonPlayerEntity.y, false, true))) {
								nearestVisible = e;
								nearestDistance = dist;
							}
						}
					}
				}
			}

		if (nearestVisible) return nearestVisible;
	}
	return KinkyDungeonPlayerEntity;
}

function KinkyDungeonInDanger() {
	for (let b of KinkyDungeonBullets) {
		let bdist = 1.5;
		if (b.vx && b.vy) bdist = 2*Math.sqrt(b.vx*b.vx + b.vy*b.vy);
		if (KinkyDungeonVisionGet(Math.round(b.x), Math.round(b.y)) > 0 && Math.max(Math.abs(b.x - KinkyDungeonPlayerEntity.x), Math.abs(b.y - KinkyDungeonPlayerEntity.y)) < bdist) {
			return true;
		}
	}
	for (let enemy of KinkyDungeonEntities) {
		let playerDist = Math.max(Math.abs(enemy.x - KinkyDungeonPlayerEntity.x), Math.abs(enemy.y - KinkyDungeonPlayerEntity.y));
		if (KinkyDungeonVisionGet(enemy.x, enemy.y) > 0) {
			if (((enemy.revealed && !enemy.Enemy.noReveal) || !enemy.Enemy.stealth || KDHelpless(enemy) || KinkyDungeonSeeAll || playerDist <= enemy.Enemy.stealth + 0.1) && !(KinkyDungeonGetBuffedStat(enemy.buffs, "Sneak") > 0)) {
				if ((KinkyDungeonAggressive(enemy) || playerDist < 1.5)) {
					if ((KDHostile(enemy) || enemy.rage) && KinkyDungeonVisionGet(enemy.x, enemy.y) > 0 &&
					(!KDAmbushAI(enemy) || enemy.ambushtrigger)) {
						return true;
					}
					if ((KDHostile(enemy) || enemy.rage) && KinkyDungeonVisionGet(enemy.x, enemy.y) > 0 &&
					(!KDAmbushAI(enemy) || enemy.ambushtrigger)) {
						return true;
					}
				}
			}
		}
	}

	return false;
}

function KDAmbushAI(enemy) {
	let AI = enemy.AI ? enemy.AI : enemy.Enemy.AI;
	let AIType = KDAIType[AI];
	if (AIType) return AIType.ambush;
	return false;
}

let KinkyDungeonFastMoveSuppress = false;
let KinkyDungeonFastStruggleSuppress = false;
function KinkyDungeonDrawEnemies(canvasOffsetX, canvasOffsetY, CamX, CamY) {
	let reenabled = false;
	let reenabled2 = false;
	if (KinkyDungeonFastMoveSuppress) { //&& !CommonIsMobile
		KinkyDungeonFastMove = true;
		KinkyDungeonFastMovePath = [];
		KinkyDungeonFastMoveSuppress = false;
		reenabled = true;
	}
	if (KinkyDungeonFastStruggleSuppress) {
		KinkyDungeonFastStruggle = true;
		KinkyDungeonFastStruggleType = "";
		KinkyDungeonFastStruggleGroup = "";
		KinkyDungeonFastStruggleSuppress = false;
		reenabled2 = true;
	}
	for (let b of KinkyDungeonBullets) {
		let bdist = 1.5;
		if (b.vx && b.vy) bdist = 2*Math.sqrt(b.vx*b.vx + b.vy*b.vy);
		if (KinkyDungeonVisionGet(Math.round(b.x), Math.round(b.y)) > 0 && Math.max(Math.abs(b.x - KinkyDungeonPlayerEntity.x), Math.abs(b.y - KinkyDungeonPlayerEntity.y)) < bdist) {
			if (KinkyDungeonFastStruggle) {
				if (KinkyDungeonFastStruggle && !KinkyDungeonFastStruggleSuppress && !reenabled2)
					KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/Click.ogg");
				KinkyDungeonFastStruggle = false;
				KinkyDungeonFastStruggleGroup = "";
				KinkyDungeonFastStruggleType = "";
				reenabled2 = false;
				//if (!CommonIsMobile)
				KinkyDungeonFastStruggleSuppress = true;
			}
			if (KinkyDungeonFastMove) {
				if (KinkyDungeonFastMove && !KinkyDungeonFastMoveSuppress && !reenabled)
					KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/Click.ogg");
				KinkyDungeonFastMove = false;
				KinkyDungeonFastMovePath = [];
				reenabled = false;
				//if (!CommonIsMobile)
				KinkyDungeonFastMoveSuppress = true;
			}
		}
	}

	for (let enemy of KinkyDungeonEntities) {
		let sprite = enemy.Enemy.name;
		KinkyDungeonUpdateVisualPosition(enemy, KinkyDungeonDrawDelta);
		let tx = enemy.visual_x;
		let ty = enemy.visual_y;
		let playerDist = Math.max(Math.abs(enemy.x - KinkyDungeonPlayerEntity.x), Math.abs(enemy.y - KinkyDungeonPlayerEntity.y));
		if (enemy.x >= CamX && enemy.y >= CamY && enemy.x < CamX + KinkyDungeonGridWidthDisplay && enemy.y < CamY + KinkyDungeonGridHeightDisplay
			&& KinkyDungeonVisionGet(enemy.x, enemy.y) > 0) {
			if (((enemy.revealed && !enemy.Enemy.noReveal) || !enemy.Enemy.stealth || KDHelpless(enemy) || KinkyDungeonSeeAll || playerDist <= enemy.Enemy.stealth + 0.1) && !(KinkyDungeonGetBuffedStat(enemy.buffs, "Sneak", true) > 0 && playerDist > 1.5)) {
				enemy.revealed = true;
				if (((KinkyDungeonAggressive(enemy) && playerDist <= 6.9) || (playerDist < 1.5 && enemy.playWithPlayer))) {
					if ((KDHostile(enemy) || enemy.rage) && KinkyDungeonVisionGet(enemy.x, enemy.y) > 0 && KinkyDungeonFastMove &&
					(!KDAmbushAI(enemy) || enemy.ambushtrigger)) {
						if (KinkyDungeonFastMove && !KinkyDungeonFastMoveSuppress && !reenabled)
							KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/Click.ogg");
						KinkyDungeonFastMove = false;
						KinkyDungeonFastMovePath = [];
						reenabled = false;
						if (!CommonIsMobile)
							KinkyDungeonFastMoveSuppress = true;
					}
					if ((KDHostile(enemy) || enemy.rage) && KinkyDungeonVisionGet(enemy.x, enemy.y) > 0 && KinkyDungeonFastStruggle &&
					(!KDAmbushAI(enemy) || enemy.ambushtrigger)) {
						if (KinkyDungeonFastStruggle && !KinkyDungeonFastStruggleSuppress && !reenabled2)
							KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/Click.ogg");
						KinkyDungeonFastStruggle = false;
						KinkyDungeonFastStruggleGroup = "";
						KinkyDungeonFastStruggleType = "";
						reenabled2 = false;
						if (!CommonIsMobile)
							KinkyDungeonFastStruggleSuppress = true;
					}
				}
				if (enemy.buffs) {
					let aura_scale = 0;
					let aura_scale_max = 0;
					for (let b of Object.values(enemy.buffs)) {
						if (b && b.aura && b.duration > 0) {
							aura_scale_max += 1;
						}
					}
					if (aura_scale_max > 0) {
						let buffs = Object.values(enemy.buffs);
						buffs = buffs.sort((a, b) => {return b.duration - a.duration;});
						for (let b of buffs) {
							if (b && b.aura && b.duration > 0 && (!b.hideHelpless || !KDHelpless(enemy))) {
								aura_scale += 1/aura_scale_max;
								let s = aura_scale;
								if (b.noAuraColor) {
									KDDraw(kdgameboard, kdpixisprites, enemy.id + "," + b.id, KinkyDungeonRootDirectory + "Aura/" + (b.aurasprite ? b.aurasprite : "Aura") + ".png",
										(tx - CamX)*KinkyDungeonGridSizeDisplay - 0.5 * KinkyDungeonGridSizeDisplay * s + KinkyDungeonGridSizeDisplay * (1 + s) * 0.167,
										(ty - CamY)*KinkyDungeonGridSizeDisplay - 0.5 * KinkyDungeonGridSizeDisplay * s + KinkyDungeonGridSizeDisplay * (1 + s) * 0.167,
										KinkyDungeonSpriteSize * (1 + s) * 0.67,
										KinkyDungeonSpriteSize * (1 + s) * 0.67, undefined, {
											zIndex: 2,
										});
								} else {
									KDDraw(kdgameboard, kdpixisprites, enemy.id + "," + b.id, KinkyDungeonRootDirectory + "Aura/" + (b.aurasprite ? b.aurasprite : "Aura") + ".png",
										(tx - CamX)*KinkyDungeonGridSizeDisplay - 0.5 * KinkyDungeonGridSizeDisplay * s + KinkyDungeonGridSizeDisplay * (1 + s) * 0.167,
										(ty - CamY)*KinkyDungeonGridSizeDisplay - 0.5 * KinkyDungeonGridSizeDisplay * s + KinkyDungeonGridSizeDisplay * (1 + s) * 0.167,
										KinkyDungeonSpriteSize * (1 + s) * 0.67,
										KinkyDungeonSpriteSize * (1 + s) * 0.67,
										undefined, {
											tint: string2hex(b.aura),
											zIndex: 2,
										});
								}

							}
						}
					}
				}

				let buffSprite = "";
				let buffSpritePower = 0;
				if (enemy.buffs) {
					for (let b of Object.values(enemy.buffs)) {
						if (b.replaceSprite && b.power > buffSpritePower) {
							buffSpritePower = b.power;
							buffSprite = b.replaceSprite;
						}
					}
				}

				if (buffSprite) sprite = buffSprite;

				if (!enemy.Enemy.bound || (KDBoundEffects(enemy) < 4 && !KDHelpless(enemy))) {
					let sp = sprite;
					if (enemy.CustomSprite && !buffSprite) sp = "CustomSprite/" + enemy.CustomSprite;
					KDDraw(kdgameboard, kdpixisprites, "spr_" + enemy.id, KinkyDungeonRootDirectory + "Enemies/" + sp + ".png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay);
				} else {
					let sp = buffSprite || enemy.Enemy.bound;
					let dir = "EnemiesBound/";
					if (enemy.CustomSprite && !buffSprite) {
						dir = "Enemies/";
						sp = "CustomSpriteBound/" + enemy.CustomSprite;
					}
					KDDraw(kdgameboard, kdpixisprites, "spr_" + enemy.id, KinkyDungeonRootDirectory + dir + sp + ".png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay);
				}
			}
		}
	}
	if (reenabled && KinkyDungeonFastMove) {
		KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/Click.ogg");
	} else if (reenabled2 && KinkyDungeonFastStruggle) {
		KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/Click.ogg");
	}
}

/**
 *
 * @param {entity} enemy
 * @param {string} flag
 * @returns {boolean}
 */
function KDEnemyHasFlag(enemy, flag) {
	return (enemy.flags && enemy.flags[flag] != undefined);
}

function KinkyDungeonDrawEnemiesStatus(canvasOffsetX, canvasOffsetY, CamX, CamY) {
	for (let enemy of KinkyDungeonEntities) {
		let tx = enemy.visual_x;
		let ty = enemy.visual_y;
		let helpless = KDHelpless(enemy);
		let playerDist = Math.max(Math.abs(enemy.x - KinkyDungeonPlayerEntity.x), Math.abs(enemy.y - KinkyDungeonPlayerEntity.y));
		if (enemy.x >= CamX && enemy.y >= CamY && enemy.x < CamX + KinkyDungeonGridWidthDisplay && enemy.y < CamY + KinkyDungeonGridHeightDisplay
			&& KinkyDungeonVisionGet(enemy.x, enemy.y) > 0) {
			let bindLevel = KDBoundEffects(enemy);
			if (((enemy.revealed && !enemy.Enemy.noReveal) || !enemy.Enemy.stealth || KDHelpless(enemy) || KinkyDungeonSeeAll || playerDist <= enemy.Enemy.stealth + 0.1) && !(KinkyDungeonGetBuffedStat(enemy.buffs, "Sneak", true) > 0)) {
				if (enemy.stun > 0) {
					KDDraw(kdgameboard, kdpixisprites, "stun" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Stun.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (enemy.silence > 1 && !helpless) {
					KDDraw(kdgameboard, kdpixisprites, "sil" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Silence.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (enemy.blind > 1 && !helpless) {
					KDDraw(kdgameboard, kdpixisprites, "bli" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Blind.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (enemy.disarm > 1 && !helpless) {
					KDDraw(kdgameboard, kdpixisprites, "dis" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Disarm.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (enemy.bind > 1 && bindLevel < 4) {
					KDDraw(kdgameboard, kdpixisprites, "bind" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Bind.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.11,
						});
				}
				if ((enemy.slow > 1 || KinkyDungeonGetBuffedStat(enemy.buffs, "MoveSpeed", true) < 0) && bindLevel < 4) {
					KDDraw(kdgameboard, kdpixisprites, "spd" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Slow.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (KinkyDungeonGetBuffedStat(enemy.buffs, "AttackDmg", true) > 0) {
					KDDraw(kdgameboard, kdpixisprites, "atkb" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Buff.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (KinkyDungeonGetBuffedStat(enemy.buffs, "AttackDmg", true) < 0 && bindLevel < 4) {
					KDDraw(kdgameboard, kdpixisprites, "atkdb" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Debuff.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (KinkyDungeonGetBuffedStat(enemy.buffs, "Armor") < 0 && enemy.Enemy.armor > 0) {
					KDDraw(kdgameboard, kdpixisprites, "armd" + enemy.id, KinkyDungeonRootDirectory + "Conditions/ArmorDebuff.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				} else if (KinkyDungeonGetBuffedStat(enemy.buffs, "Armor") > 0) {
					KDDraw(kdgameboard, kdpixisprites, "arm" + enemy.id, KinkyDungeonRootDirectory + "Conditions/ArmorBuff.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (KinkyDungeonGetBuffedStat(enemy.buffs, "Evasion") > 0) {
					KDDraw(kdgameboard, kdpixisprites, "evab" + enemy.id, KinkyDungeonRootDirectory + "Conditions/EvasionBuff.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (KinkyDungeonGetBuffedStat(enemy.buffs, "DamageReduction") > 0) {
					KDDraw(kdgameboard, kdpixisprites, "shield" + enemy.id, KinkyDungeonRootDirectory + "Conditions/ShieldBuff.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (KinkyDungeonGetBuffedStat(enemy.buffs, "DamageAmp", true) > 0) {
					KDDraw(kdgameboard, kdpixisprites, "amp" + enemy.id, KinkyDungeonRootDirectory + "Conditions/DamageAmp.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
				if (enemy.freeze > 0) {
					KDDraw(kdgameboard, kdpixisprites, "frz" + enemy.id, KinkyDungeonRootDirectory + "Conditions/Freeze.png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay, undefined, {
							zIndex: 2.1,
						});
				}
			}
		}
	}
}

function KinkyDungeonDrawEnemiesWarning(canvasOffsetX, canvasOffsetY, CamX, CamY) {
	for (let enemy of KinkyDungeonEntities) {
		if (enemy.warningTiles) {
			for (let t of enemy.warningTiles) {
				let tx = enemy.x + t.x;
				let ty = enemy.y + t.y;
				let special = enemy.usingSpecial ? "Special" : "";
				let attackMult = KinkyDungeonGetBuffedStat(enemy.buffs, "AttackSlow", true);
				let attackPoints = enemy.attackPoints - attackMult + 1.1;
				let preHit = false;
				if (((enemy.usingSpecial && enemy.Enemy.specialAttackPoints) ? enemy.Enemy.specialAttackPoints : enemy.Enemy.attackPoints) > attackPoints) {
					special = special + "Basic";
					preHit = true;
				}
				//  && KinkyDungeonMovableTilesEnemy.includes(KinkyDungeonMapGet(tx, ty))
				if (tx >= CamX && ty >= CamY && tx < CamX + KinkyDungeonGridWidthDisplay && ty < CamY + KinkyDungeonGridHeightDisplay && !(tx == enemy.x && ty == enemy.y)) {
					let color = enemy.Enemy.color ? string2hex(enemy.Enemy.color) : 0xff5555;

					KDDraw(kdgameboard, kdpixisprites, tx + "," + ty + "_w" + enemy.id, KinkyDungeonRootDirectory + ((KDAllied(enemy)) ? "WarningAlly" : "WarningColor" + special) + ".png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
							tint: color,
							zIndex: 2.22 + 0.001 * (enemy.Enemy.power ? enemy.Enemy.power : 0),
						});
					KDDraw(kdgameboard, kdpixisprites, tx + "," + ty + "_w_b" + enemy.id, KinkyDungeonRootDirectory + "WarningBacking" + ".png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
						KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
							tint: color,
							zIndex: (preHit ? -0.2 : 0.1) + 0.001 * (enemy.Enemy.power ? enemy.Enemy.power : 0),
						});
					KDDraw(kdgameboard, kdpixisprites, tx + "," + ty + "_w_h" + enemy.id, KinkyDungeonRootDirectory + ((KDAllied(enemy)) ? "WarningHighlightAlly" : "WarningHighlight" + special) + ".png",
						(tx - CamX)*KinkyDungeonGridSizeDisplay - 1, (ty - CamY)*KinkyDungeonGridSizeDisplay - 1,
						KinkyDungeonSpriteSize + 2, KinkyDungeonSpriteSize + 2, undefined, {
							zIndex: 2.21,
						});
				}
			}
		}
		let mp = enemy.Enemy.movePoints + KDBoundEffects(enemy) * 0.5;
		let ms = KinkyDungeonGetBuffedStat(enemy.buffs, "MoveSpeed") ? KinkyDungeonMultiplicativeStat(-KinkyDungeonGetBuffedStat(enemy.buffs, "MoveSpeed")) : 1;
		if (enemy.fx && enemy.fy && enemy.movePoints >= mp - ms - 0.0001) {
			let tx = enemy.fx;
			let ty = enemy.fy;
			if (tx >= CamX && ty >= CamY && tx < CamX + KinkyDungeonGridWidthDisplay && ty < CamY + KinkyDungeonGridHeightDisplay
				&& KDCanSeeEnemy(enemy, Math.max(Math.abs(enemy.x - KinkyDungeonPlayerEntity.x), Math.abs(enemy.y - KinkyDungeonPlayerEntity.y)))
				&& KinkyDungeonVisionGet(enemy.x, enemy.y) > 0) {
				let color = enemy.Enemy.color ? string2hex(enemy.Enemy.color) : 0xff5555;
				KDDraw(kdgameboard, kdpixisprites, tx + "," + ty + "_w_m" + enemy.id, KinkyDungeonRootDirectory + ("WarningMove") + ".png",
					(tx - CamX)*KinkyDungeonGridSizeDisplay - 1, (ty - CamY)*KinkyDungeonGridSizeDisplay - 1,
					KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
						tint: color,
						zIndex: -0.05,
					});
			}
		}
		if (enemy.Enemy.spells && (enemy.Enemy.spellRdy && (!KDAmbushAI(enemy) || enemy.ambushtrigger)) && !(enemy.castCooldown > 1) && (!(enemy.silence > 0) && !(enemy.stun > 0) && !(enemy.freeze > 0) && !KDHelpless(enemy))) {
			let tx = enemy.visual_x;
			let ty = enemy.visual_y;
			//  && KinkyDungeonMovableTilesEnemy.includes(KinkyDungeonMapGet(tx, ty))
			if (tx >= CamX && ty >= CamY && tx < CamX + KinkyDungeonGridWidthDisplay && ty < CamY + KinkyDungeonGridHeightDisplay
				&& KDCanSeeEnemy(enemy, Math.max(Math.abs(enemy.x - KinkyDungeonPlayerEntity.x), Math.abs(enemy.y - KinkyDungeonPlayerEntity.y)))
				&& KinkyDungeonVisionGet(enemy.x, enemy.y) > 0) {
				KDDraw(kdgameboard, kdpixisprites, enemy.id + "_sr", KinkyDungeonRootDirectory + "SpellReady.png",
					(tx - CamX)*KinkyDungeonGridSizeDisplay, (ty - CamY)*KinkyDungeonGridSizeDisplay,
					KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, enemy.Enemy.color ? {
						tint: string2hex(enemy.Enemy.color),
					} : undefined);
			}
		}
	}
}

function KinkyDungeonBar(x, y, w, h, value, foreground = "#66FF66", background = "#ff0000", orig = undefined, origColor = "#ff4444", notches = undefined, notchcolor = "#ffffff", notchbg = "#ffffff", zIndex = 55) {
	if (value < 0) value = 0;
	if (value > 100) value = 100;
	let id = x + "," + y + "," + w + "," + h + foreground;
	if (background != "none")
		FillRectKD(kdcanvas, kdpixisprites, id + '1', {
			Left: x + 1,
			Top: y + 1,
			Width: w - 2,
			Height: h - 2,
			Color: "#000000",
			LineWidth: 1,
			zIndex: zIndex+value*0.0001,
		});
	FillRectKD(kdcanvas, kdpixisprites, id + '2', {
		Left: x + 2,
		Top: y + 2,
		Width: Math.floor((w - 4) * value / 100),
		Height: h - 4,
		Color: foreground,
		LineWidth: 1,
		zIndex: zIndex + .1,
	});
	if (background != "none")
		FillRectKD(kdcanvas, kdpixisprites, id + '3', {
			Left: Math.floor(x + 2 + (w - 4) * value / 100),
			Top: y + 2,
			Width: Math.floor((w - 4) * (100 - value) / 100),
			Height: h - 4,
			Color: background,
			LineWidth: 1,
			zIndex: zIndex + .2,
		});
	if (orig != undefined)
		FillRectKD(kdcanvas, kdpixisprites, id + '4', {
			Left: Math.min(
				Math.floor(x + 2 + (w - 4) * orig / 100),
				Math.floor(x + 2 + (w - 4) * value / 100)
			),
			Top: y + 2,
			Width: Math.floor((w - 4) * Math.abs(value - orig) / 100),
			Height: h - 4,
			Color: origColor,
			LineWidth: 1,
			zIndex: zIndex + .3,
		});
	if (notches) {
		for (let n of notches) {
			if (n > 0 && n < 1) {
				FillRectKD(kdcanvas, kdpixisprites, id + '5' + n, {
					Left: x + Math.floor((w - 4) * n) - 1,
					Top: y + 2,
					Width: 3,
					Height: h - h,
					Color: notchbg,
					LineWidth: 1,
					zIndex: zIndex + .4,
				});
				FillRectKD(kdcanvas, kdpixisprites, id + '6' + n, {
					Left: x + Math.floor((w - 4) * n),
					Top: y + 2,
					Width: 1,
					Height: h - 4,
					Color: notchcolor,
					LineWidth: 1,
					zIndex: zIndex + .5,
				});
			}
		}
	}
}

/**
 *
 * @param {entity} enemy
 * @param {number} playerDist
 * @returns {boolean}
 */
function KDCanSeeEnemy(enemy, playerDist) {
	return (((enemy.revealed && !enemy.Enemy.noReveal) || !enemy.Enemy.stealth || KDHelpless(enemy) || KinkyDungeonSeeAll || playerDist <= enemy.Enemy.stealth + 0.1) && !(KinkyDungeonGetBuffedStat(enemy.buffs, "Sneak") > 0));
}

/**
 *
 * @param {entity} enemy
 * @returns {number}
 */
function KDGetEnemyStruggleRate(enemy) {
	let level = KDBoundEffects(enemy);
	let mult = 0.1;

	if (enemy.boundLevel > enemy.Enemy.maxhp * 10) {
		mult = 0;
	} else {
		if (enemy.disarm > 0) mult *= 0.5;
		if (enemy.silence > 0) mult *= 0.75;
		if (enemy.blind > 0) mult *= 0.75;
		if (enemy.bind > 0) mult *= 0.5;
		else if (enemy.slow > 0) mult *= 0.75;
		if (level > 3) mult *= 4; // Struggle faster when bound heavily, because they're using all their energy to try to escape
		if (enemy.vulnerable > 0 || enemy.attackPoints > 0) mult *= 0.5; // They're busy
		if (enemy.boundLevel > 0) {
			mult *= Math.pow(1.5, -enemy.boundLevel / enemy.Enemy.maxhp); // The more you tie, the stricter the bondage gets
		}
		if (enemy.distraction > 0) mult *= 1 / (1 + 2 * enemy.distraction / enemy.Enemy.maxhp);
		if (KinkyDungeonGetBuffedStat(enemy.buffs, "Lockdown")) mult *= KinkyDungeonGetBuffedStat(enemy.buffs, "Lockdown");
	}
	let amount = mult * (10 + Math.pow(Math.max(0.01, enemy.hp), 0.75)); // Lower health enemies struggle slower
	return amount;
}

/**
 *
 * @param {entity} enemy
 * @returns {number}
 */
function KDGetEnemyDistractRate(enemy) {
	let level = KDBoundEffects(enemy);
	let mult = enemy.distraction > 0.9 ? 0.02 : (enemy.distraction > 0.5 ? 0.04 : 0.06);
	if (KDStrictPersonalities.includes(enemy.personality)) mult = mult * 2;
	else if (!KDLoosePersonalities.includes(enemy.personality)) mult = mult * 1.5;

	return mult * enemy.Enemy.maxhp / (1 + level * 0.25);
}

let KDMaxBindingBars = 3;

function KinkyDungeonDrawEnemiesHP(canvasOffsetX, canvasOffsetY, CamX, CamY) {
	let tooltip = false;
	for (let enemy of KinkyDungeonEntities) {
		let playerDist = Math.max(Math.abs(enemy.x - KinkyDungeonPlayerEntity.x), Math.abs(enemy.y - KinkyDungeonPlayerEntity.y));
		if (enemy.x >= CamX && enemy.y >= CamY && enemy.x < CamX + KinkyDungeonGridWidthDisplay && enemy.y < CamY + KinkyDungeonGridHeightDisplay
			&& KinkyDungeonVisionGet(enemy.x, enemy.y) > 0) {
			let xx = enemy.visual_x ? enemy.visual_x : enemy.x;
			let yy = enemy.visual_y ? enemy.visual_y : enemy.y;
			let II = 0;
			// Draw bars
			if ((!enemy.Enemy.stealth || KDHelpless(enemy) || playerDist <= enemy.Enemy.stealth + 0.1) && !(KinkyDungeonGetBuffedStat(enemy.buffs, "Sneak") > 0)) {
				if ((KDAllied(enemy) || ((enemy.lifetime != undefined || enemy.hp < enemy.Enemy.maxhp || enemy.boundLevel)))) {
					let spacing = 8;
					// Draw binding bars
					let helpless = KDHelpless(enemy);
					if (enemy.boundLevel != undefined && enemy.boundLevel > 0) {
						if (!helpless) {
							let bindingBars = Math.ceil(enemy.boundLevel / enemy.Enemy.maxhp);
							for (let i = 0; i < bindingBars && i < KDMaxBindingBars; i++) {
								if (i > 0) II++;
								let mod = 0;
								if (i == bindingBars - 1) {
									mod = KDGetEnemyStruggleRate(enemy);
									KinkyDungeonBar(canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay + 12 - 15 - spacing*II,
										KinkyDungeonGridSizeDisplay, 8, Math.min(1, (enemy.boundLevel - i * enemy.Enemy.maxhp) / enemy.Enemy.maxhp) * 100, "#ffffff", "#52333f");
									KinkyDungeonBar(1 + canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay + 12 - 15 - spacing*II,
										KinkyDungeonGridSizeDisplay, 8, Math.min(1, (enemy.boundLevel - mod - i * enemy.Enemy.maxhp) / enemy.Enemy.maxhp) * 100, "#444444", "none");
								}
								KinkyDungeonBar(canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay + 12 - 15 - spacing*II,
									KinkyDungeonGridSizeDisplay, 8, Math.min(1, (Math.max(0, enemy.boundLevel - mod - i * enemy.Enemy.maxhp)) / enemy.Enemy.maxhp) * 100, "#ffae70", i == bindingBars - 1 ? "none" : "#52333f",
									undefined, undefined, [0.25, 0.5, 0.75], "#85522c", "#85522c");
							}
						} else {
							// TODO draw a lock or some other icon
						}
					}
					// Draw HP bar
					if (!helpless) {

						if (enemy.hp < enemy.Enemy.maxhp || KDAllied(enemy)) {
							// Draw hp bar
							KinkyDungeonBar(canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - 15 - II * spacing,
								KinkyDungeonGridSizeDisplay, 10, enemy.hp / enemy.Enemy.maxhp * 100, KDAllied(enemy) ? "#00ff88" : "#ff0000", KDAllied(enemy) ? "#aa0000" : "#000000"); II++;
						}

						if (enemy.distraction > 0) {
							// Draw distraction bar
							KinkyDungeonBar(canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - 15 - II * spacing,
								KinkyDungeonGridSizeDisplay, 6, enemy.distraction / enemy.Enemy.maxhp * 100, "#fda1ff", "#9300ff");
							KDDraw(kdcanvas, kdpixisprites, enemy.id + "_ar_heart", KinkyDungeonRootDirectory + (enemy.distraction >= 0.9 * enemy.Enemy.maxhp ? "UI/HeartExtreme.png" : "UI/Heart.png"),
								-7 + canvasOffsetX + (xx - CamX + enemy.distraction / enemy.Enemy.maxhp)*KinkyDungeonGridSizeDisplay,
								-4 + canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - 15 - II * spacing,
								14, 14, undefined, {
									zIndex: 103,
								});
							II++;
						}

						if (enemy.lifetime != undefined && enemy.maxlifetime > 0 && enemy.maxlifetime < 999 && ((!enemy.Enemy.hidetimerbar && !enemy.hideTimer) || KDAllied(enemy))) {
							// Draw lifetime bar
							KinkyDungeonBar(canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - 12 - 15 - II * spacing,
								KinkyDungeonGridSizeDisplay, 12, enemy.lifetime / enemy.maxlifetime * 100, "#cccccc", "#000000"); II++;
						}
					}
				}
			}


			// Draw status bubbles
			if (KDCanSeeEnemy(enemy, playerDist)) {
				// Draw thought bubbles
				let yboost = II * -12;
				if (enemy.Enemy.specialdialogue || enemy.specialdialogue) {
					KDDraw(kdcanvas, kdpixisprites, enemy.id + "_th", KinkyDungeonRootDirectory + "Conditions/Dialogue.png",
						canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/2 + yboost,
						KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
							zIndex: 103,
						});
				}
				let bb = false;
				if (enemy.Enemy.bound && KDThoughtBubbles.has(enemy.id)) {
					let bubble = KDThoughtBubbles.get(enemy.id);
					if (bubble.index + bubble.duration >= KinkyDungeonCurrentTick) {
						bb = true;
						let name = CommonTime() % 1000 < 500 ? "Thought" : bubble.name;
						if (name != "Thought" || !((enemy.lifetime != undefined || enemy.hp < enemy.Enemy.maxhp || enemy.boundLevel)))
							KDDraw(kdcanvas, kdpixisprites, enemy.id + "_th", KinkyDungeonRootDirectory + `Conditions/Thought/${name}.png`,
								canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/2 + yboost,
								KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
									zIndex: 103,
								});
					}
				}
				if (!KDHelpless(enemy)) {
					if (!KinkyDungeonAggressive(enemy) && ((!KDAllied(enemy) && !enemy.Enemy.specialdialogue && !bb) || KDEnemyHasFlag(enemy, "Shop")) && !enemy.playWithPlayer && enemy.Enemy.movePoints < 90 && !KDAmbushAI(enemy)) {
						KDDraw(kdcanvas, kdpixisprites, enemy.id + "_shop", KinkyDungeonRootDirectory + ((KDEnemyHasFlag(enemy, "Shop")) ? "Conditions/Shop.png" : (KDAllied(enemy) ? "Conditions/Heart.png" : "Conditions/Peace.png")),
							canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/2 + yboost,
							KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
								zIndex: 102,
							});
					} else if (!bb && enemy.aware && KDHostile(enemy) && enemy.vp > 0 && enemy.Enemy && !enemy.Enemy.noAlert && enemy.Enemy.movePoints < 90 && !KDAmbushAI(enemy)) {
						KDDraw(kdcanvas, kdpixisprites, enemy.id + "_aw", KinkyDungeonRootDirectory + "Conditions/Aware.png",
							canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/2 + yboost,
							KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
								zIndex: 102,
							});
					} else if (!bb && enemy.vp > 0.01 && KDHostile(enemy) && enemy.Enemy && !enemy.Enemy.noAlert && enemy.Enemy.movePoints < 90 && !KDAmbushAI(enemy)) {
						let sneakThreshold = enemy.Enemy.sneakThreshold ? enemy.Enemy.sneakThreshold : 2;
						if (KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "Sneak")) sneakThreshold = Math.max(0.1, sneakThreshold + KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "Sneak"));
						if (enemy.vp > sneakThreshold/2)
							KDDraw(kdcanvas, kdpixisprites, enemy.id + "_vp", KinkyDungeonRootDirectory + "Conditions/vp.png",
								canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/2 + yboost,
								KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
									zIndex: 102,
								});
					}
					if (enemy.vulnerable > 0)
						KDDraw(kdcanvas, kdpixisprites, enemy.id + "_vuln", KinkyDungeonRootDirectory + "Conditions/Vulnerable.png",
							canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/2 + yboost,
							KinkyDungeonSpriteSize, KinkyDungeonSpriteSize, undefined, {
								zIndex: 102,
							});
				}

				if (!tooltip && (!KDAmbushAI(enemy) || enemy.ambushtrigger) && MouseIn(canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay, canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay,
					KinkyDungeonGridSizeDisplay, KinkyDungeonGridSizeDisplay)) {
					let faction = KDGetFaction(enemy);
					if (faction && (!KinkyDungeonHiddenFactions.includes(faction) || KinkyDungeonTooltipFactions.includes(faction))) {
						let tt = TextGet("KinkyDungeonFaction" + faction);
						DrawTextFitKD(tt, canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2, yboost + canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/3, 10 + tt.length * 8, "white", "black");
						yboost += -2*KinkyDungeonGridSizeDisplay/7;
					}

					let name = TextGet("Name" + enemy.Enemy.name);
					DrawTextFitKD(name, canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2, yboost + canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/3, 10 + name.length * 8, "white", "black");

					if (enemy.CustomName) {
						DrawTextKD(enemy.CustomName, canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2, yboost + canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/1.5, enemy.CustomNameColor, "black");

					}


					tooltip = true;

					if (enemy.buffs && enemy.buffs.Analyze) {
						let i = 0;
						let spacing = 25;
						let pad = 70;
						if (enemy.Enemy.dmgType) {
							let dt = KinkyDungeonDamageTypes[enemy.Enemy.dmgType];
							if (dt) {
								i += 1;
								let str = TextGet("KinkyDungeonTooltipDealsDamage").replace("DAMAGETYPE", TextGet("KinkyDungeonDamageType" + enemy.Enemy.dmgType));
								DrawTextFitKD(str,
									1 + canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2,
									1 + canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/7 + pad + spacing * i, 10 + str.length * 8, dt.bg, dt.bg);
								DrawTextFitKD(str,
									canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2,
									canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/7 + pad + spacing * i, 10 + str.length * 8, dt.color, dt.bg);
								break;
							}
						}
						if (enemy.Enemy.armor) {
							i += 1;
							let str = TextGet("KinkyDungeonTooltipArmor").replace("AMOUNT", "" + enemy.Enemy.armor);
							DrawTextFitKD(str,
								canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2,
								canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/7 + pad + spacing * i, 10 + str.length * 8, "white", "black");
						}
						if (enemy.Enemy.evasion) {
							i += 1;
							let str = TextGet("KinkyDungeonTooltipEvasion").replace("AMOUNT", "" + Math.round(100 * KinkyDungeonMultiplicativeStat(enemy.Enemy.evasion)));
							DrawTextFitKD(str,
								canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2,
								canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/7 + pad + spacing * i, 10 + str.length * 8, "white", "black");
						}

						let list = Array.from(Object.keys(enemy.Enemy.tags));
						if (enemy.Enemy.spellResist)
							list.push("magic");
						let magic = false;
						for (let t of list) {
							for (let dt of Object.values(KinkyDungeonDamageTypes)) {
								if ((t == dt.name + "resist" || t == dt.name + "weakness" || t == dt.name + "immune" || t == dt.name + "severeweakness")
									|| (dt.name == "magic" && t.includes("magic") && enemy.Enemy.spellResist)) {
									i += 1;
									let mult = 1.0;
									if (t == dt.name + "resist") mult = 0.5;
									else if (t == dt.name + "weakness") mult = 1.5;
									else if (t == dt.name + "immune") mult = 0;
									else if (t == dt.name + "severeweakness") mult = 2.0;
									if (dt.name == "magic" && !magic && enemy.Enemy.spellResist) {
										magic = true;
										mult *= KinkyDungeonMultiplicativeStat(enemy.Enemy.spellResist);
									}
									let str = TextGet("KinkyDungeonTooltipWeakness").replace("MULTIPLIER", "" + Math.round(mult * 100)/100).replace("DAMAGETYPE", TextGet("KinkyDungeonDamageType"+ dt.name));
									DrawTextFitKD(str,
										1 + canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2,
										1 + canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/7 + pad + spacing * i, 10 + str.length * 8, dt.bg, dt.bg);
									DrawTextFitKD(str,
										canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2,
										canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/7 + pad + spacing * i, 10 + str.length * 8, dt.color, dt.bg);

								}
							}
						}
					}
				}

				if (enemy.dialogue && !tooltip) {
					DrawTextFitKD(enemy.dialogue, canvasOffsetX + (xx - CamX)*KinkyDungeonGridSizeDisplay + KinkyDungeonGridSizeDisplay/2, yboost + canvasOffsetY + (yy - CamY)*KinkyDungeonGridSizeDisplay - KinkyDungeonGridSizeDisplay/1.5, 10 + enemy.dialogue.length * 8, enemy.dialogueColor, "black");
				}
			}
		}
	}
}

function KDGetColor(enemy) {
	return "#ffffff";
	//if (enemy.color) return enemy.color;
	//if (enemy.Enemy.color) return enemy.Enemy.color;
	//return "#ffff44";
}

let KDChampionMax = 10;

/**
 *
 * @param {entity} enemy
 * @returns {boolean} Whether or not it was a Champion capture
 */
function KinkyDungeonCapture(enemy) {
	let msg = "KinkyDungeonCapture";
	let goddessCapture = false;
	if (enemy.lifetime != undefined && enemy.lifetime < 999) {
		msg = "KinkyDungeonCaptureBasic";
	} else if (KDGameData.Champion) {
		if (KDGameData.ChampionCurrent < KDChampionMax) {
			msg = "KinkyDungeonCaptureGoddess";
			let disapproval = 0;
			goddessCapture = true;
			let spell = KinkyDungeonFindSpell("Summon", true);
			if (spell) {
				KinkyDungeonCastSpell(enemy.x, enemy.y, spell, undefined, undefined, undefined);
			}
			// Is the player wearing something related to the goddess?
			if (KinkyDungeonStatsChoice.has("BoundCrusader")) {
				let uniform = ["Rope", "Leather", "Metal", "Latex"];
				if (uniform.includes(KDGameData.Champion)) uniform = [KDGameData.Champion];
				let restraints = [];
				for (let u of uniform) {
					for (let r of KinkyDungeonGetRestraintsWithShrine(u, true)) {
						restraints.push(r);
					}
				}
				let minAmount = 1;
				if (KinkyDungeonGoddessRep[KDGameData.Champion] > 10) minAmount = 2;
				if (KinkyDungeonGoddessRep[KDGameData.Champion] > 30) minAmount = 3;
				if (restraints.length < minAmount) {
					msg = "KinkyDungeonCaptureGoddess" + (minAmount == 1 ? "Low" : "None") + (uniform.includes(KDGameData.Champion) ? "Uniform" : "Restraint");
					if (minAmount == 1)
						disapproval = 1;
					else
						disapproval = 2;
				}
			}
			if (disapproval == 0) {
				KinkyDungeonChangeRep(KDGameData.Champion, 1);
				KDGameData.ChampionCurrent += 1;
			} else goddessCapture = false;
		} else msg = "KinkyDungeonCaptureMax";
	} else msg = "KinkyDungeonCaptureBasic";

	KinkyDungeonSendEvent("capture", {enemy: enemy});
	KinkyDungeonSendActionMessage(6, TextGet(msg).replace("EnemyName", TextGet("Name" + enemy.Enemy.name)).replace("GODDESS", TextGet("KinkyDungeonShrine" + KDGameData.Champion)), "lightgreen", 2);
	return goddessCapture;
}

/**
 *
 * @param {entity} enemy
 */
function KDDropStolenItems(enemy) {
	if (enemy.items) {
		for (let name of enemy.items) {
			let item = {x:enemy.x, y:enemy.y, name: name};
			KinkyDungeonGroundItems.push(item);
		}
		enemy.items = [];
	}
}

function KinkyDungeonEnemyCheckHP(enemy, E) {
	if (enemy.hp <= 0) {
		let noRepHit = false;
		KinkyDungeonSendEvent("death", {});
		KDSpliceIndex(E, 1);
		KinkyDungeonSendEvent("kill", {enemy: enemy});
		if (KDBoundEffects(enemy) > 3 && enemy.boundLevel > 0 && KDHostile(enemy) && !enemy.Enemy.tags.nocapture && enemy.playerdmg) {
			KDDropStolenItems(enemy);
			if (!KinkyDungeonCapture(enemy)) noRepHit = true;
		} else {
			KDDropStolenItems(enemy);
			if (enemy == KinkyDungeonKilledEnemy && Math.max(3, enemy.Enemy.maxhp/4) >= KinkyDungeonActionMessagePriority) {
				if (KDistChebyshev(enemy.x - KinkyDungeonPlayerEntity.x, enemy.y - KinkyDungeonPlayerEntity.y) < 10)
					KinkyDungeonSendActionMessage(4, TextGet("Kill"+enemy.Enemy.name), "orange", 2, undefined, undefined, enemy);
				KinkyDungeonKilledEnemy = null;
			}
		}


		if (!(enemy.lifetime < 9000)) {
			if (enemy.playerdmg) {
				if (enemy.Enemy && enemy.Enemy.tags && enemy.Enemy.tags.boss)
					KinkyDungeonChangeRep("Ghost", -5);
				else if (enemy.Enemy && enemy.Enemy.tags && enemy.Enemy.tags.miniboss)
					KinkyDungeonChangeRep("Ghost", -2);
				else if (enemy.Enemy && enemy.Enemy.tags && enemy.Enemy.tags.elite && KDRandom() < 0.33)
					KinkyDungeonChangeRep("Ghost", -1);


				if (enemy.rep)
					for (let rep of Object.keys(enemy.rep))
						KinkyDungeonChangeRep(rep, enemy.rep[rep]);

				if (enemy.factionrep)
					for (let rep of Object.keys(enemy.factionrep))
						KinkyDungeonChangeFactionRep(rep, enemy.factionrep[rep]);

				if (enemy.Enemy.rep && !enemy.noRep)
					for (let rep of Object.keys(enemy.Enemy.rep))
						KinkyDungeonChangeRep(rep, enemy.Enemy.rep[rep]);

				if (enemy.Enemy.factionrep && !enemy.noRep)
					for (let rep of Object.keys(enemy.Enemy.factionrep))
						KinkyDungeonChangeFactionRep(rep, enemy.Enemy.factionrep[rep]);

				if (KinkyDungeonStatsChoice.has("Vengeance")) {
					KinkyDungeonChangeDistraction(Math.max(0, Math.ceil(Math.pow(enemy.Enemy.maxhp, 0.7))), false, 0.75);
				}

				let faction = KDGetFaction(enemy);
				let amount = 0;

				if (!KinkyDungeonHiddenFactions.includes(faction)) {
					if (enemy.Enemy && enemy.Enemy.tags && enemy.Enemy.tags.boss)
						amount = 0.04;
					else if (enemy.Enemy && enemy.Enemy.tags && enemy.Enemy.tags.miniboss)
						amount = 0.02;
					else if (enemy.Enemy && enemy.Enemy.tags && enemy.Enemy.tags.elite)
						amount = 0.01;
					if (enemy.Enemy && enemy.Enemy.tags && !enemy.Enemy.tags.minor)
						amount = 0.004;
					if (enemy.Enemy && enemy.Enemy.tags && enemy.Enemy.tags.minor)
						amount = KDRandom() < 0.33 ? 0.004 : 0.001;

				}
				if (amount && !noRepHit) {
					KinkyDungeonChangeFactionRep(faction, -amount);

					// For being near a faction
					let boostfactions = [];
					let hurtfactions = [];
					for (let e of KinkyDungeonEntities) {
						let dist = KDistChebyshev(e.x - enemy.x, e.y - enemy.y);
						if (dist < 10) {
							let faction2 = KDGetFaction(e);
							if (!KinkyDungeonHiddenFactions.includes(faction2)) {
								if (KDFactionRelation(faction, faction2) < -0.1 && !boostfactions.includes(faction2)) {
									boostfactions.push(faction2);
									let mult = 1.0;
									if (amount > 0) {
										if (KDFactionRelation("Player", faction2) > 0.5)
											mult *= 0.05;
										else if (KDFactionRelation("Player", faction2) > 0.25)
											mult *= 0.5;
									}
									KinkyDungeonChangeFactionRep(faction2, 0.5 * amount * mult * -KDFactionRelation(faction, faction2));
									// Add a favor
									KDAddFavor(faction2, amount);
								} else
								if (KDFactionRelation(faction, faction2) > 0.1 && !hurtfactions.includes(faction2)) {
									hurtfactions.push(faction2);
									KinkyDungeonChangeFactionRep(faction2, 0.5 * amount * -KDFactionRelation(faction, faction2));
								}
							}
						}
					}
				}
			} else if (!enemy.summoned && !enemy.Enemy.immobile && !enemy.Enemy.tags.temporary) {
				if (!KDGameData.RespawnQueue) KDGameData.RespawnQueue = [];
				KDGameData.RespawnQueue.push({enemy: enemy.Enemy.name, faction: KDGetFaction(enemy)});
			}
		}

		if (enemy.ondeath) {
			for (let o of enemy.ondeath) {
				KDOndeath[o.type](enemy, o);
			}
		}
		if (enemy.Enemy.ondeath) {
			for (let o of enemy.Enemy.ondeath) {
				KDOndeath[o.type](enemy, o);
			}
		}
		KDDropItems(enemy);

		return true;
	} else if (KDHelpless(enemy)) {
		KDDropStolenItems(enemy);
		if (!enemy.droppedItems)
			KDDropItems(enemy);
	}
	return false;
}

/**
 *
 * @param {entity} enemy
 */
function KDDropItems(enemy) {
	if (!enemy.noDrop && (enemy.playerdmg || !enemy.summoned) && !enemy.droppedItems) {
		KinkyDungeonItemDrop(enemy.x, enemy.y, enemy.Enemy.dropTable, enemy.summoned);
		enemy.droppedItems = true;
		let dropped = null;
		if (enemy.data && enemy.data.shop && KDShops[enemy.data.shop] && KDShops[enemy.data.shop].items) {
			for (let i of KDShops[enemy.data.shop].items) {
				dropped = {x:enemy.x, y:enemy.y, name: i};
				KinkyDungeonGroundItems.push(dropped);
			}
		}
		else if (KDEnemyHasFlag(enemy, "Shop")) {
			dropped = {x:enemy.x, y:enemy.y, name: "Gold", amount: 100};
			KinkyDungeonGroundItems.push(dropped);
		}
	}
}


/**
 *
 * @param {entity} Enemy
 * @returns {boolean} - If the NPC is eligible to use favors
 */
function KDFavorNPC(Enemy) {
	// Only enemies which are not temporarily allied, or summoned by you, or specifically allied (like angels), are eligible to show up in dialogue
	return Enemy && !Enemy.allied && !Enemy.Enemy.allied;
}

/**
 *
 * @param {entity} Enemy
 * @returns {number} - Gets the favor with the enemy
 */
function KDGetFavor(Enemy) {
	if (KDGameData.Favors)
		return KDGameData.Favors[KDGetFactionOriginal(Enemy)] ? KDGameData.Favors[KDGetFactionOriginal(Enemy)] : 0;
	return 0;
}

/**
 *
 * @param {entity} Enemy
 * @param {number} Amount
 */
function KDChangeFavor(Enemy, Amount) {
	KDModFavor(KDGetFactionOriginal(Enemy), Amount);
}

function KDAddFavor(Faction, Amount) {
	KDModFavor(Faction, Math.abs(Amount));
}
function KDModFavor(Faction, Amount) {
	if (!KDGameData.Favors) KDGameData.Favors = {};
	if (!KDGameData.Favors[Faction]) KDGameData.Favors[Faction] = 0;
	KDGameData.Favors[Faction] = Math.max(KDGameData.Favors[Faction] + Amount, 0);
}

function KinkyDungeonCheckLOS(enemy, player, distance, maxdistance, allowBlind, allowBars) {
	let bs = (enemy && enemy.Enemy && enemy.Enemy.blindSight) ? enemy.Enemy.blindSight : 0;
	if (KinkyDungeonStatsChoice.get("KillSquad")) bs += 20;
	if (player.player && enemy.Enemy && (enemy.Enemy.playerBlindSight || KDAllied(enemy.Enemy))) bs = enemy.Enemy.playerBlindSight;
	return distance <= maxdistance && ((allowBlind && bs >= distance) || KinkyDungeonCheckPath(enemy.x, enemy.y, player.x, player.y, allowBars));
}

function KinkyDungeonTrackSneak(enemy, delta, player, darkmult) {
	if (!enemy.vp) enemy.vp = 0;
	if (!player.player) return true;
	let sneakThreshold = enemy.Enemy.sneakThreshold ? enemy.Enemy.sneakThreshold : 2;
	if (KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "Sneak")) sneakThreshold = Math.max(0.1, sneakThreshold + KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "Sneak"));
	let deltaMult = 1/Math.max(1, (1 + KinkyDungeonSubmissiveMult));
	if (KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "SlowDetection")) deltaMult *= KinkyDungeonMultiplicativeStat(KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "SlowDetection"));
	if (KDGameData.Outfit) {
		let outfit = KinkyDungeonGetOutfit(KDGameData.Outfit);
		if (outfit && outfit.visibility)
			deltaMult *= outfit.visibility;
	}
	if (KinkyDungeonStatsChoice.get("Conspicuous")) deltaMult *= KDConspicuousMult;
	else if (KinkyDungeonStatsChoice.get("Stealthy")) deltaMult *= KDStealthyMult;
	if (darkmult) {
		deltaMult *= KDPlayerLight/(darkmult + KDPlayerLight);
	}
	enemy.vp = Math.min(sneakThreshold * 2, enemy.vp + delta*deltaMult);
	return (enemy.vp > sneakThreshold);
}

function KinkyDungeonMultiplicativeStat(Stat) {
	if (Stat > 0) {
		return 1 / (1 + Stat);
	}
	if (Stat < 0) {
		return 1 - Stat;
	}

	return 1;
}

/**
 *
 * @param {number} x
 * @param {number} y
 * @param {number} dist
 * @param {entity} [hostileEnemy]
 * @returns {entity[]}
 */
function KDNearbyEnemies(x, y, dist, hostileEnemy) {
	let cache = KDGetEnemyCache();
	let list = [];
	if (!cache) {
		for (let e of KinkyDungeonEntities) {
			if (KDistEuclidean(x - e.x, y - e.y) <= dist && (!hostileEnemy || KDHostile(e, hostileEnemy))) list.push(e);
		}
	} else {
		let e = null;
		for (let X = Math.floor(x - dist); X < Math.ceil(x + dist); X++)
			for (let Y = Math.floor(y - dist); Y < Math.ceil(y + dist); Y++) {
				e = cache.get(X + "," + Y);
				if (e && (!hostileEnemy || KDHostile(e, hostileEnemy))) list.push(e);
			}
	}
	return list;
}

function KinkyDungeonGetRandomEnemyPoint(avoidPlayer, onlyPlayer, Enemy) {
	let tries = 0;

	while (tries < 100) {
		let points = Array.from(KinkyDungeonRandomPathablePoints, ([name, value]) => (value));
		let point = points[Math.floor(points.length * KDRandom())];
		if (point) {
			let X = point.x;//1 + Math.floor(KDRandom()*(KinkyDungeonGridWidth - 1));
			let Y = point.y;//1 + Math.floor(KDRandom()*(KinkyDungeonGridHeight - 1));
			let playerDist = 6;
			let PlayerEntity = KinkyDungeonNearestPlayer({x:X, y:Y});

			if (((!avoidPlayer || Math.sqrt((X - PlayerEntity.x) * (X - PlayerEntity.x) + (Y - PlayerEntity.y) * (Y - PlayerEntity.y)) > playerDist)
				&& (!onlyPlayer || Math.sqrt((X - PlayerEntity.x) * (X - PlayerEntity.x) + (Y - PlayerEntity.y) * (Y - PlayerEntity.y)) <= playerDist))
				&& (!KinkyDungeonPointInCell(X, Y)) && KinkyDungeonMovableTilesEnemy.includes(KinkyDungeonMapGet(X, Y))
				&& KinkyDungeonNoEnemyExceptSub(X, Y, true, Enemy) && (!KinkyDungeonTiles.get(X + "," + Y) || !KinkyDungeonTiles.get(X + "," + Y).OffLimits)) {
				return {x: X, y:Y};
			}
		}
		tries += 1;
	}

	return undefined;
}

function KinkyDungeonGetNearbyPoint(x, y, allowNearPlayer=false, Enemy, Adjacent, ignoreOffLimits) {
	let slots = [];
	for (let X = -Math.ceil(1); X <= Math.ceil(1); X++)
		for (let Y = -Math.ceil(1); Y <= Math.ceil(1); Y++) {
			if ((X != 0 || Y != 0) && KinkyDungeonTransparentObjects.includes(KinkyDungeonMapGet(x + X, y + Y))) {
				// We add the slot and those around it
				slots.push({x:x + X, y:y + Y});
				slots.push({x:x + X, y:y + Y});
				slots.push({x:x + X, y:y + Y});
				if (!Adjacent)
					for (let XX = -Math.ceil(1); XX <= Math.ceil(1); XX++)
						for (let YY = -Math.ceil(1); YY <= Math.ceil(1); YY++) {
							if ((Math.abs(X + XX) > 1 || Math.abs(Y + YY) > 1) && KinkyDungeonMovableTilesEnemy.includes(KinkyDungeonMapGet(x + XX + X, y + YY + Y))) {
								slots.push({x:x + XX + X, y:y + YY + Y});
								slots.push({x:x + XX + X, y:y + YY + Y});
								for (let XXX = -Math.ceil(1); XXX <= Math.ceil(1); XXX++)
									for (let YYY = -Math.ceil(1); YYY <= Math.ceil(1); YYY++) {
										if ((Math.abs(X + XX + XXX) > 2 || Math.abs(Y + YY + YYY) > 2) && KinkyDungeonMovableTilesEnemy.includes(KinkyDungeonMapGet(x + XX + XXX + X, y + YYY + YY + Y))) {
											slots.push({x:x + XXX + XX + X, y:y + YYY + YY + Y});
										}
									}
							}
						}
			}
		}

	let foundslot = undefined;
	for (let C = 0; C < 100; C++) {
		let slot = slots[Math.floor(KDRandom() * slots.length)];
		if (slot && KinkyDungeonNoEnemyExceptSub(slot.x, slot.y, false, Enemy) && (ignoreOffLimits || !KinkyDungeonTiles.get(slot.x + "," + slot.y) || !KinkyDungeonTiles.get(slot.x + "," + slot.y).NoWander)
			&& (allowNearPlayer || Math.max(Math.abs(KinkyDungeonPlayerEntity.x - slot.x), Math.abs(KinkyDungeonPlayerEntity.y - slot.y)) > 1.5)
			&& KinkyDungeonMovableTilesEnemy.includes(KinkyDungeonMapGet(slot.x, slot.y))) {
			foundslot = {x: slot.x, y: slot.y};

			C = 100;
		} else slots.splice(C, 1);
	}
	return foundslot;
}

function KinkyDungeonSetEnemyFlag(enemy, flag, duration) {
	if (!enemy.flags) enemy.flags = {};
	if (enemy.flags[flag]) {
		if (duration == 0) {
			delete enemy.flags[flag];// = undefined;
			return;
		}
		if (enemy.flags[flag] == -1) return;
		if (enemy.flags[flag] < duration) enemy.flags[flag] = duration;
	} else if (duration) enemy.flags[flag] = duration;
}

/**
 *
 * @param {entity} enemy
 * @param {number} delta
 */
function KinkyDungeonTickFlagsEnemy(enemy, delta) {
	if (enemy.flags) {
		for (let f of Object.entries(enemy.flags)) {
			if (f[1] == -1) continue;
			if (f[1] > 0) enemy.flags[f[0]] = f[1] - delta;
			if (f[1] <= 0) delete enemy.flags[f[0]];
		}
	}
}

let KinkyDungeonDamageTaken = false;
let KinkyDungeonTorsoGrabCD = 0;
let KinkyDungeonHuntDownPlayer = false;

/**
 *
 * @param {entity} enemy
 * @returns {boolean}
 */
function KinkyDungeonHasStatus(enemy) {
	return enemy && (enemy.bind > 0 || enemy.slow > 0 || enemy.stun > 0 || enemy.freeze > 0 || enemy.silence > 0 || KinkyDungeonIsSlowed(enemy) || KDBoundEffects(enemy) > 0);
}


/**
 *
 * @param {entity} enemy
 * @returns {boolean}
 */
function KinkyDungeonIsDisabled(enemy) {
	return enemy && (enemy.stun > 0 || enemy.freeze > 0 || KDBoundEffects(enemy) > 3);
}


/**
 *
 * @param {entity} enemy
 * @returns {boolean}
 */
function KinkyDungeonIsSlowed(enemy) {
	return enemy && ((KDBoundEffects(enemy) > 0 && KDBoundEffects(enemy) < 4) || enemy.slow > 0 || KinkyDungeonGetBuffedStat(enemy.buffs, "MoveSpeed") < 0);
}


/**
 *
 * @param {entity} enemy
 * @returns {boolean}
 */
function KinkyDungeonCanCastSpells(enemy) {
	return enemy && !(KinkyDungeonIsDisabled(enemy) || enemy.silence > 0);
}

function KDCanBind(enemy) {
	return (enemy?.Enemy?.bound != undefined);
}

function KDBoundEffects(enemy) {
	if (!enemy.Enemy.bound) return 0;
	if (!enemy.boundLevel) return 0;
	let boundLevel = enemy.boundLevel ? enemy.boundLevel : 0;
	let bindAmp = KinkyDungeonMultiplicativeStat(-KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "BindAmp"));
	boundLevel *= bindAmp;
	if (boundLevel > enemy.Enemy.maxhp || (enemy.hp <= 0.1*enemy.Enemy.maxhp && boundLevel > enemy.hp)) return 4; // Totally tied
	if (boundLevel > enemy.Enemy.maxhp*0.75) return 3;
	if (boundLevel > enemy.Enemy.maxhp*0.5) return 2;
	if (boundLevel > enemy.Enemy.maxhp*0.25) return 1;
	return 0;
}


function KinkyDungeonUpdateEnemies(delta, Allied) {
	let tickAlertTimer = false;
	let tickAlertTimerFactions = [];
	let visionMod = 1.0;
	let defeat = false;

	/*if (KinkyDungeonMapParams[KinkyDungeonMapIndex[MiniGameKinkyDungeonCheckpoint]]) {
		if (KinkyDungeonMapParams[KinkyDungeonMapIndex[MiniGameKinkyDungeonCheckpoint]].brightness) {
			visionMod = Math.min(1.0, Math.max(0.5, KinkyDungeonMapParams[KinkyDungeonMapIndex[MiniGameKinkyDungeonCheckpoint]].brightness / 8));
		}
	}*/

	if (Allied) {
		KinkyDungeonUpdateDialogue(KinkyDungeonPlayerEntity, delta);
		let KinkyDungeonSummons = 0;
		for (let i = KinkyDungeonEntities.length-1; i >= 0; i--) {
			let enemy = KinkyDungeonEntities[i];
			KinkyDungeonUpdateDialogue(enemy, delta);
			if (KDAllied(enemy) && enemy.summoned && enemy.Enemy.allied && enemy.Enemy.CountLimit && (!enemy.lifetime || enemy.lifetime > 999)) {
				KinkyDungeonSummons += 1;
				if (KinkyDungeonSummons > KinkyDungeonSummonCount) {
					enemy.hp -= Math.max(0.1 * enemy.hp) + 1;
				}
			}
		}
	} else {
		if (KinkyDungeonTorsoGrabCD > 0) KinkyDungeonTorsoGrabCD -= 1;

		if (KDGameData.KinkyDungeonLeashedPlayer > 0) {
			KDGameData.KinkyDungeonLeashedPlayer -= 1;

			let nearestJail = KinkyDungeonNearestJailPoint(KinkyDungeonPlayerEntity.x, KinkyDungeonPlayerEntity.y);
			if (nearestJail) {
				let xx = nearestJail.x;
				let yy = nearestJail.y;
				let jaildoor = KDGetJailDoor(xx, yy).tile;
				if (jaildoor && jaildoor.Type == "Door") {
					jaildoor.Lock = undefined;
				}
			}

		}
		KinkyDungeonUpdateFlags(delta);
	}

	// Loop 1
	for (let enemy of KinkyDungeonEntities) {
		if ((Allied && KDAllied(enemy)) || (!Allied && !KDAllied(enemy))) {
			let master = KinkyDungeonFindMaster(enemy).master;
			if (master && enemy.aware) master.aware = true;
			if (master && master.aware) enemy.aware = true;
			if (enemy.Enemy.master && enemy.Enemy.master.dependent && !master) enemy.hp = -10000;

			if (!enemy.castCooldown) enemy.castCooldown = 0;
			if (enemy.castCooldown > 0) {
				let cdmult = enemy.distraction ? 1 / (1 + enemy.distraction / enemy.Enemy.maxhp) : 1;
				cdmult = cdmult * KinkyDungeonMultiplicativeStat(-KinkyDungeonGetBuffedStat(enemy.buffs, "CastSpeed"));
				enemy.castCooldown = Math.max(0, enemy.castCooldown-delta * cdmult);
				if (enemy.castCooldown <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "specialCD"});
			}
			if (!enemy.castCooldownSpecial) enemy.castCooldownSpecial = 0;
			if (enemy.castCooldownSpecial > 0) {
				enemy.castCooldownSpecial = Math.max(0, enemy.castCooldownSpecial-delta);
				if (enemy.castCooldownSpecial <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "castCooldownSpecial"});
			}

			if (enemy.Enemy.specialCharges && enemy.specialCharges <= 0) enemy.specialCD = 999;
			KinkyDungeonTickFlagsEnemy(enemy, delta);
			if (enemy.specialCD > 0) {
				enemy.specialCD -= delta;
				if (enemy.specialCD <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "specialCD"});
			}
			if (enemy.slow > 0) {
				enemy.slow -= delta;
				if (enemy.slow <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "slow"});
			}
			if (enemy.boundLevel > 0 && !(enemy.stun > 0 || enemy.freeze > 0) && (enemy.hp > enemy.Enemy.maxhp * 0.1)) {
				let SR = KDGetEnemyStruggleRate(enemy);
				let minLevel = (enemy.buffs && KinkyDungeonGetBuffedStat(enemy.buffs, "MinBoundLevel")) ? KinkyDungeonGetBuffedStat(enemy.buffs, "MinBoundLevel") : 0;
				enemy.boundLevel = Math.max(Math.min(Math.max(0, enemy.boundLevel), minLevel), enemy.boundLevel - delta * SR);

				if (SR <= 0 || KDRandom() < 0.1) {
					KDAddThought(enemy.id, "GiveUp", 5, SR <= 0 ? 4 : 1);
				} else {
					if (KDLoosePersonalities.includes(enemy.personality)) {
						KDAddThought(enemy.id, "Embarrassed", 2, 4);
					} else if (KDStrictPersonalities.includes(enemy.personality)) {
						KDAddThought(enemy.id, "Struggle", 2, 2);
					} else {
						KDAddThought(enemy.id, "Annoyed", 2, 2);
					}
				}

				if (enemy.boundLevel <= 0) {
					KDAddThought(enemy.id, "Annoyed", 5, 1);
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "boundLevel"});
				}
			}

			if (enemy.distraction > 0 ) {
				let DR = KDGetEnemyDistractRate(enemy);
				if (enemy.distraction > enemy.Enemy.maxhp) {
					enemy.distraction = enemy.Enemy.maxhp;
					KDAddThought(enemy.id, "Embarrassed", 7, 1);
				} else {
					if (DR <= 0 || KDRandom() < 0.1) {
						KDAddThought(enemy.id, "GiveUp", 5, DR <= 0 ? 4 : 1);
					} else {
						if (KDLoosePersonalities.includes(enemy.personality)) {
							KDAddThought(enemy.id, "Play", 1, 4);
						} else if (KDStrictPersonalities.includes(enemy.personality)) {
							KDAddThought(enemy.id, "Annoyed", 1, 3);
						} else {
							KDAddThought(enemy.id, "Embarrassed", 1, 2);
						}
					}
				}
				enemy.distraction = Math.max(0, enemy.distraction - delta * DR);


				if (enemy.distraction <= 0) {
					KDAddThought(enemy.id, "Annoyed", 5, 1);
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "boundLevel"});
				}
			}

			let bindLevel = KDBoundEffects(enemy);
			let statusBonus = 1;
			if (enemy.Enemy.tags.unstoppable) statusBonus *= 4;
			else if (enemy.Enemy.tags.unflinching) statusBonus *= 2;

			if (enemy.Enemy.rage) enemy.rage = 9999;
			if (enemy.bind > 0) {
				enemy.bind -= delta;
				if (enemy.bind <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "bind"});
			}
			if (enemy.rage > 0) {
				enemy.rage -= delta;
				if (enemy.rage <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "rage"});
			}
			if (enemy.hostile > 0) {
				enemy.hostile -= delta;
				if (enemy.hostile <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "hostile"});
			}
			if (enemy.allied > 0 && enemy.allied < 9000) {
				enemy.allied -= delta;
				if (enemy.allied <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "allied"});
			}
			if (enemy.ceasefire > 0 && enemy.ceasefire < 9000) {
				enemy.ceasefire -= delta;
				if (enemy.ceasefire <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "ceasefire"});
			}
			if (enemy.blind > 0 && bindLevel < 4) {
				enemy.blind -= delta * statusBonus / (1 + 1*bindLevel);
				if (enemy.blind <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "blind"});
			}
			if (enemy.disarm > 0 && bindLevel < 4) {
				enemy.disarm -= delta * statusBonus / (1 + 1*bindLevel);
				if (enemy.disarm <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "disarm"});
			}
			if (enemy.playWithPlayer > 0) {
				enemy.playWithPlayer -= delta;
				if (enemy.playWithPlayer <= 0) {
					if (!KinkyDungeonAggressive(enemy)) {
						KDResetIntent(enemy, AIData);
						KDAddThought(enemy.id, "Happy", 5, 1);
					}
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "playWithPlayer"});
				}
			}
			if (enemy.playWithPlayerCD > 0) {
				enemy.playWithPlayerCD -= delta;
				if (enemy.playWithPlayerCD <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "playWithPlayerCD"});
			}
			if (enemy.silence > 0 && bindLevel < 4) {
				enemy.silence -= delta * statusBonus / (1 + 1*bindLevel);
				if (enemy.silence <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "silence"});
			}
			if (enemy.disarmflag > 0 && enemy.Enemy.disarm && KinkyDungeonLastAction != "Attack") {
				enemy.disarmflag = Math.max(0, enemy.disarmflag - enemy.Enemy.disarm);
				if (enemy.disarmflag <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "disarmflag"});
			}
			if (enemy.stun > 0 || enemy.freeze > 0) {
				enemy.warningTiles = [];
				enemy.disarmflag = 0;
				enemy.fx = undefined;
				enemy.fy = undefined;
				if (enemy.stun > 0 && enemy.stun <= delta)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "stun"});
				if (enemy.freeze > 0 && enemy.freeze <= delta)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "freeze"});
				let smult = 1 - 0.167 * KDBoundEffects(enemy);
				let fmult = KDHelpless(enemy) ? 0.1 : 1 - 0.2 * KDBoundEffects(enemy);
				if (enemy.stun > 0) enemy.stun = Math.max(enemy.stun - delta * smult, 0);
				if (enemy.freeze > 0) enemy.freeze = Math.max(enemy.freeze - delta * fmult, 0);
			} else if (enemy.channel > 0) {
				enemy.warningTiles = [];
				if (enemy.channel > 0) enemy.channel -= delta;

				if (enemy.channel <= 0)
					KinkyDungeonSendEvent("enemyStatusEnd", {enemy: enemy, status: "channel"});
			}
		}
	}
	// Loop 2
	for (let E = 0; E < KinkyDungeonEntities.length; E++) {
		let enemy = KinkyDungeonEntities[E];
		if ((Allied && KDAllied(enemy)) || (!Allied && !KDAllied(enemy))) {
			if (enemy.vulnerable > 0) enemy.vulnerable -= delta;
			else enemy.vulnerable = 0;
			if (enemy.Enemy.tags.nonvulnerable && enemy.vulnerable) enemy.vulnerable = 0;
			if (!(KDGameData.KinkyDungeonPenance && KinkyDungeonAngel()) || enemy == KinkyDungeonAngel()) {
				// Delete the enemy
				if (KinkyDungeonEnemyCheckHP(enemy, E)) { E -= 1; continue;}

				let player = (!KinkyDungeonAngel()) ? KinkyDungeonNearestPlayer(enemy, false, true, enemy.Enemy.visionRadius ? (enemy.Enemy.visionRadius + ((enemy.lifetime > 0 && enemy.Enemy.visionSummoned) ? enemy.Enemy.visionSummoned : 0)) : 0) : KinkyDungeonPlayerEntity;


				if (enemy.Enemy.convertTiles) {
					let tile = KinkyDungeonMapGet(enemy.x, enemy.y);
					for (let c of enemy.Enemy.convertTiles) {
						if (c.from == tile && c.to) {
							KinkyDungeonMapSet(enemy.x, enemy.y, c.to);
						}
					}
				}

				KinkyDungeonHandleTilesEnemy(enemy, delta);

				if (enemy.Enemy.triggersTraps) {
					KinkyDungeonHandleTraps(enemy.x, enemy.y, true);
				}

				let idle = true;
				//let bindLevel = KDBoundEffects(enemy);

				if (!(
					KinkyDungeonIsDisabled(enemy)
					|| KDHelpless(enemy)
					|| enemy.channel > 0
				)) {
					let start = performance.now();

					let playerItems = [];
					for (let inv of KinkyDungeonAllWeapon()) {
						if (inv.name != "Unarmed")
							playerItems.push(inv);
					}
					for (let inv of KinkyDungeonAllConsumable()) {
						playerItems.push(inv);
					}
					let ret = KinkyDungeonEnemyLoop(enemy, player, delta, visionMod, playerItems);
					idle = ret.idle;
					if (ret.defeat) {
						defeat = true;
					}
					if (enemy.items && !KDEnemyHasFlag(enemy, "shop")) {
						let light = KinkyDungeonVisionGet(enemy.x, enemy.y);
						if (light == 0 && !enemy.aware && KDRandom() < 0.2) {
							KDClearItems(enemy);
						}
					}
					let end = performance.now();
					if (KDDebug)
						console.log(`Took ${end - start} milliseconds to run loop for enemy ${enemy.Enemy.name}`);
				} else {
					// These happen when an enemy is disabled
					enemy.disarmflag = 0;
					enemy.fx = undefined;
					enemy.fy = undefined;
				}

				if (idle) {
					// These happen when an enemy is disabled or not doing anything
					enemy.movePoints = 0;
					enemy.attackPoints = 0;
					enemy.warningTiles = [];
				}

				KinkyDungeonHandleTilesEnemy(enemy, delta);

				if (enemy.vp > 0 && (!enemy.path || enemy.path.length < 4)) {
					let sneakThreshold = enemy.Enemy.sneakThreshold ? enemy.Enemy.sneakThreshold : 2;
					if (enemy.vp > sneakThreshold * 2 && !enemy.aware) {
						let sneak = KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "Sneak");
						if (sneak > 0)
							enemy.vp = Math.max(sneakThreshold + 1, Math.max(Math.min(enemy.vp, sneakThreshold), enemy.vp * 0.7 - 0.1));
					}
					enemy.vp = Math.max(0, enemy.vp - 0.1);
				}

				// Delete the enemy
				if (KinkyDungeonEnemyCheckHP(enemy, E)) { E -= 1;} else {
					if (enemy.aware && (enemy.lifetime == undefined || enemy.lifetime > 9000) && !enemy.Enemy.tags.temporary && !enemy.Enemy.tags.peaceful) {
						if (enemy.hostile > 0 && enemy.hostile < 9000 && (KDGameData.PrisonerState == 'parole' || KDGameData.PrisonerState == 'jail')) {
							if (!(enemy.silence > 0)) {
								tickAlertTimer = true;
								if (KDistChebyshev(KinkyDungeonPlayerEntity.x - enemy.x, KinkyDungeonPlayerEntity.y - enemy.y) < 9 && !tickAlertTimerFactions.includes(KDGetFaction(enemy))) {
									tickAlertTimerFactions.push(KDGetFaction(enemy));
								}
							}
						} else if (KinkyDungeonAggressive(enemy)) {
							if (!(enemy.silence > 0)) {
								tickAlertTimer = true;
								if (KDistChebyshev(KinkyDungeonPlayerEntity.x - enemy.x, KinkyDungeonPlayerEntity.y - enemy.y) < 9 && !tickAlertTimerFactions.includes(KDGetFaction(enemy))) {
									tickAlertTimerFactions.push(KDGetFaction(enemy));
								}
							}
						}
					}
				}
				if (enemy.Enemy.regen && (enemy.hp > 0.01 || enemy.Enemy.regen < 0)) enemy.hp = Math.min(enemy.Enemy.maxhp, enemy.hp + enemy.Enemy.regen * delta);
				if (enemy.Enemy.lifespan || enemy.lifetime != undefined) {
					if (enemy.lifetime == undefined) enemy.lifetime = enemy.Enemy.lifespan;
					if (enemy.lifetime <= 9000)
						enemy.lifetime -= delta;
					if (enemy.lifetime <= 0) enemy.hp = -10000;
				}
			}
		}
	}


	if (!Allied) {
		// vulnerability calc
		for (let i = KinkyDungeonEntities.length-1; i >= 0; i--) {
			let enemy = KinkyDungeonEntities[i];
			// Make it so you can backstab enemies while your allies fight them
			KDCheckVulnerableBackstab(enemy);
			// Alert enemies if youve aggroed one
			if (!KDAllied(enemy) && !(enemy.ceasefire > 0)) {
				if (!(enemy.hostile > 0) && tickAlertTimerFactions.length > 0 && !KinkyDungeonAggressive(enemy) && !enemy.Enemy.tags.peaceful && (enemy.vp > 0.5 || enemy.lifetime < 900 || (!KDHostile(enemy) && KDistChebyshev(enemy.x - KinkyDungeonPlayerEntity.x, enemy.y - KinkyDungeonPlayerEntity.y) < 7))) {
					for (let f of tickAlertTimerFactions) {
						if ((KDGetFaction(enemy) != "Player") && (
							(KDFactionAllied(f, enemy) && KDFactionRelation("Player", enemy) <= 0.9)
							|| (KDFactionRelation(f, enemy) >= 0.51 && KDFactionRelation("Player", enemy) <= 0.4)
							|| (KDFactionRelation(f, enemy) >= 0.39 && KDFactionRelation("Player", enemy) <= 0.25)
							|| (KDFactionRelation(f, enemy) >= 0.25 && KDFactionRelation("Player", enemy) <= -0.1)
							|| (KDFactionRelation(f, enemy) >= 0.1 && KDFactionRelation("Player", enemy) <= -0.25))) {
							KDMakeHostile(enemy, KDMaxAlertTimer);
						}
					}
				}
			}
		}

		let alertingFaction = false;
		for (let f of tickAlertTimerFactions) {
			if (KDFactionRelation("Jail", f) > -0.01 && KDFactionRelation("Chase", f) > -0.01) {
				alertingFaction = true;
			}
		}
		if (tickAlertTimer && (KDGameData.PrisonerState == 'parole' || KDGameData.PrisonerState == 'jail') && alertingFaction) {
			if (KDGameData.AlertTimer < 3*KDMaxAlertTimer) KDGameData.AlertTimer += delta;
		} else if (KDGameData.AlertTimer > 0) {
			KDGameData.AlertTimer -= delta * 3;
		}
		if (KDGameData.AlertTimer >= KDMaxAlertTimer) {
			KinkyDungeonStartChase(undefined, "Alert");
		}

		KinkyDungeonHandleJailSpawns(delta);
		KinkyDungeonHandleWanderingSpawns(delta);
		KinkyDungeonAlert = 0;
	}

	if (defeat) {
		KinkyDungeonDefeat(KinkyDungeonFlags.has("LeashToPrison"));
	}

}

function KDMakeHostile(enemy, timer) {
	if (!timer) timer = KDMaxAlertTimerAggro;
	if (!enemy.hostile) enemy.hostile = timer;
	else enemy.hostile = Math.max(enemy.hostile, timer);
}

/**
 * Makes an enemy vulnerable if you are behind them
 * @param {entity} enemy
 */
function KDCheckVulnerableBackstab(enemy) {
	if (KDHostile(enemy)) {
		if (enemy.fx && enemy.fy && KDistChebyshev(enemy.fx - enemy.x, enemy.fy - enemy.y) < 1.5 && !enemy.Enemy.tags.noflank) {
			if (enemy.x * 2 - enemy.fx == KinkyDungeonPlayerEntity.x && enemy.y * 2 - enemy.fy == KinkyDungeonPlayerEntity.y) {
				KDAddThought(enemy.id, "Annoyed", 4, 1);
				enemy.vulnerable = Math.max(enemy.vulnerable, 1);
				return true;
			}
		}
	}
	return false;
}

/**
 *
 * @param {entity} enemy
 * @returns {string}
 */
function KDGetAI(enemy) {
	if (enemy.AI) return enemy.AI;
	else return enemy.Enemy.AI;
}

/**
 * @type {Map<number, {name: string, priority: number, duration: number, index: number}>}
 */
let KDThoughtBubbles = new Map();

function KDAddThought(id, name, priority, duration) {
	let pri = -1;
	let n = "";
	let i = 0;
	let d = 1;
	if (KDThoughtBubbles.has(id)) {
		pri = KDThoughtBubbles.get(id).priority;
		n = KDThoughtBubbles.get(id).name;
		d = KDThoughtBubbles.get(id).duration;
		i = KDThoughtBubbles.get(id).index;
	}
	// Different name means the bubble is refreshed
	if (priority > pri || (n != name && KinkyDungeonCurrentTick > d + i) || (n != name && priority >= pri)) {
		KDThoughtBubbles.set(id, {
			name: name,
			priority: priority,
			duration: duration,
			index: KinkyDungeonCurrentTick,
		});
	}
}

function KDEnemyCanTalk(enemy) {
	return enemy.Enemy && (enemy.Enemy.tags.jailer || enemy.Enemy.tags.jail || enemy.Enemy.playLine) && !(enemy.silence > 0);
}

let AIData = {};

/**
 *
 * @param {entity} enemy
 * @param {*} player
 * @param {number} delta
 * @param {number} visionMod
 * @param {item[]} playerItems
 * @returns {{idle: boolean, defeat: boolean}}
 */
function KinkyDungeonEnemyLoop(enemy, player, delta, visionMod, playerItems) {
	AIData = {};

	//let allied = KDAllied(enemy);
	//let hostile = KDHostile(enemy);

	AIData.defeat = false;
	AIData.idle = true;
	AIData.moved = false;
	AIData.ignore = false;
	AIData.visionMod = visionMod;
	AIData.followRange = enemy.Enemy.followRange;
	AIData.visionRadius = enemy.Enemy.visionRadius ? (enemy.Enemy.visionRadius + ((enemy.lifetime > 0 && enemy.Enemy.visionSummoned) ? enemy.Enemy.visionSummoned : 0)) : 0;
	let AIType = KDAIType[enemy.AI ? enemy.AI : enemy.Enemy.AI];
	if (AIData.visionMod && AIData.visionRadius > 1.5) AIData.visionRadius = Math.max(1.5, AIData.visionRadius * AIData.visionMod);
	AIData.chaseRadius = 8 + (Math.max(AIData.followRange * 2, 0)) + 2*Math.max(AIData.visionRadius ? AIData.visionRadius : 0, enemy.Enemy.blindSight ? enemy.Enemy.blindSight : 0);
	AIData.blindSight = (enemy && enemy.Enemy && enemy.Enemy.blindSight) ? enemy.Enemy.blindSight : 0;
	if (KinkyDungeonStatsChoice.get("KillSquad")) {
		AIData.visionRadius *= 2;
		AIData.chaseRadius *= 2;
		AIData.blindSight += 20;
		if (AIData.blindSight > AIData.visionRadius) {
			AIData.visionRadius = AIData.blindSight;
		}
		if (AIData.blindSight > AIData.chaseRadius) {
			AIData.chaseRadius = AIData.blindSight;
		}
	}
	AIData.ignoreLocks = enemy.Enemy.keys || enemy.keys || enemy == KinkyDungeonJailGuard() || (KDEnemyHasFlag(enemy, "keys"));
	AIData.harmless = (KinkyDungeonPlayerDamage.dmg <= enemy.Enemy.armor || !KinkyDungeonHasWill(0.1)) && !KinkyDungeonFlags.has("PlayerCombat") && !KinkyDungeonCanTalk() && !KinkyDungeonPlayer.CanInteract() && KinkyDungeonSlowLevel > 1;

	AIData.playerDist = Math.sqrt((enemy.x - player.x)*(enemy.x - player.x) + (enemy.y - player.y)*(enemy.y - player.y));

	AIData.leashing = enemy.Enemy.tags.leashing && KDFactionRelation(KDGetFaction(enemy), "Jail") > -0.1;
	AIData.highdistraction = enemy.distraction > 0 && enemy.distraction >= enemy.Enemy.maxhp * 0.9;
	AIData.distracted = AIData.highdistraction && KDLoosePersonalities.includes(enemy.personality);
	// Check if the enemy ignores the player
	if (player.player && !KDAllied(enemy)) {
		if (AIData.playerDist < 1.5 && KinkyDungeonAllRestraint().some((r) => {return KDRestraint(r).ignoreNear;})) AIData.ignore = true;
		if (!AIData.leashing && !KinkyDungeonHasWill(0.1) && KinkyDungeonAllRestraint().some((r) => {return KDRestraint(r).ignoreIfNotLeash;})) AIData.ignore = true;

		if (!KinkyDungeonFlags.has("PlayerCombat") || enemy.Enemy.tags.ignorebrat) {
			if (enemy.Enemy.tags.ignorenoSP && !KinkyDungeonHasWill(0.1)) AIData.ignore = true;
			if ((KDGetFaction(enemy) == "Ambush" || enemy.Enemy.tags.ignoreharmless) && (!enemy.warningTiles || enemy.warningTiles.length == 0)
				&& AIData.harmless && (!enemy.Enemy.ignorechance || KDRandom() < enemy.Enemy.ignorechance || !KinkyDungeonHasWill(0.1))) AIData.ignore = true;
			if (enemy.Enemy.tags.ignoretiedup && (!enemy.warningTiles || enemy.warningTiles.length == 0) && enemy.lifetime == undefined
				&& !KinkyDungeonPlayer.CanInteract() && !KinkyDungeonCanTalk() && !KinkyDungeonPlayer.CanInteract() && KinkyDungeonSlowLevel > 1
				&& (!enemy.Enemy.ignorechance || KDRandom() < enemy.Enemy.ignorechance || !KinkyDungeonHasWill(0.1))) AIData.ignore = true;
			if (enemy.Enemy.tags.ignoregagged && (!enemy.warningTiles || enemy.warningTiles.length == 0) && enemy.lifetime == undefined
				&& !KinkyDungeonCanTalk()
				&& (!enemy.Enemy.ignorechance || KDRandom() < enemy.Enemy.ignorechance || !KinkyDungeonHasWill(0.1))) AIData.ignore = true;
			if (enemy.Enemy.tags.ignoreboundhands && (!enemy.warningTiles || enemy.warningTiles.length == 0) && enemy.lifetime == undefined
				&& (KinkyDungeonPlayerDamage.dmg <= enemy.Enemy.armor || !KinkyDungeonHasWill(0.1)) && !KinkyDungeonPlayer.CanInteract()
				&& (!enemy.Enemy.ignorechance || KDRandom() < enemy.Enemy.ignorechance || !KinkyDungeonHasWill(0.1))) AIData.ignore = true;
		}
		if (enemy.Enemy.ignoreflag) {
			for (let f of enemy.Enemy.ignoreflag) {
				if (KinkyDungeonFlags.get(f)) AIData.ignore = true;
			}
		}
		// Instead of leashing we ignore
		if (enemy.Enemy.tags.leashing && !AIData.leashing && !KinkyDungeonHasWill(0.1) && !KinkyDungeonPlayer.CanInteract()) {
			AIData.ignore = true;
		}
		if (!KinkyDungeonAggressive(enemy) && !(enemy.rage > 0) && !enemy.Enemy.alwaysHostile && (!enemy.playWithPlayer || !player.player)) AIData.ignore = true;
		if (AIData.distracted) AIData.ignore = true;
	}

	AIData.MovableTiles = KinkyDungeonMovableTilesEnemy;
	AIData.AvoidTiles = "g";
	if (enemy.Enemy.tags && enemy.Enemy.tags.opendoors) AIData.MovableTiles = KinkyDungeonMovableTilesSmartEnemy;
	if (enemy.Enemy.ethereal) {
		AIData.AvoidTiles = "";
		AIData.MovableTiles = AIData.MovableTiles + "1X";
	} else if (enemy.Enemy.squeeze && KDGameData.KinkyDungeonLeashingEnemy != enemy.id) {
		AIData.MovableTiles = AIData.MovableTiles + 'b';
		AIData.AvoidTiles = "";
	}

	AIData.attack = enemy.Enemy.attack;
	AIData.range = enemy.Enemy.attackRange;
	AIData.width = enemy.Enemy.attackWidth;
	AIData.bindLevel = KDBoundEffects(enemy);
	AIData.accuracy = enemy.Enemy.accuracy ? enemy.Enemy.accuracy : 1.0;
	if (enemy.distraction) AIData.accuracy = AIData.accuracy / (1 + 1.5 * enemy.distraction / enemy.Enemy.maxhp);
	if (AIData.bindLevel) AIData.accuracy = AIData.accuracy / (1 + 0.5 * AIData.bindLevel);
	if (enemy.blind > 0) AIData.accuracy = 0;
	AIData.vibe = false;
	AIData.damage = enemy.Enemy.dmgType;
	AIData.power = enemy.Enemy.power;

	AIData.targetRestraintLevel = 0.25 + (enemy.aggro ? enemy.aggro : 0) + 0.004 * (KinkyDungeonGoddessRep.Prisoner + 50);
	if (enemy.aggro > 0 && delta > 0) enemy.aggro = enemy.aggro * 0.95;
	if (KinkyDungeonStatsChoice.has("NoWayOut") || KinkyDungeonCanPlay(enemy) || enemy.hp < enemy.Enemy.maxhp * 0.5) AIData.targetRestraintLevel = 999;
	AIData.addLeash = AIData.leashing && KDBoundPowerLevel >= AIData.targetRestraintLevel && (!KinkyDungeonGetRestraintItem("ItemNeck") || !KinkyDungeonGetRestraintItem("ItemNeckRestraints"));
	if (!AIData.addLeash && AIData.leashing && enemy.IntentLeashPoint && (!KinkyDungeonGetRestraintItem("ItemNeck") || !KinkyDungeonGetRestraintItem("ItemNeckRestraints"))) AIData.addLeash = true;

	if (enemy.Enemy.tags && AIData.leashing && (!KinkyDungeonHasWill(0.1) || AIData.addLeash)) {
		AIData.followRange = 1;
		if (!AIData.attack.includes("Bind")) AIData.attack = "Bind" + AIData.attack;
	}

	AIData.refreshWarningTiles = false;

	AIData.hitsfx = (enemy.Enemy && enemy.Enemy.hitsfx) ? enemy.Enemy.hitsfx : "";
	if (KinkyDungeonAlert && AIData.playerDist < KinkyDungeonAlert) {
		if (KDPlayerLight < 1.5 && AIData.playerDist < KinkyDungeonAlert*0.5) {
			if (!enemy.aware && KinkyDungeonAggressive(enemy)) KDAddThought(enemy.id, "Blind", 3, 3);
		} else {
			if (!enemy.aware && KinkyDungeonAggressive(enemy)) KDAddThought(enemy.id, "Aware", 3, 3);
			enemy.aware = true;
			if (!enemy.aggro) enemy.aggro = 0;
			enemy.aggro += 0.1;
		}

	}
	if (enemy.Enemy.specialAttack && (!enemy.specialCD || enemy.specialCD <= 0) && (!enemy.Enemy.specialMinrange || AIData.playerDist > enemy.Enemy.specialMinrange)) {
		AIData.attack = AIData.attack + enemy.Enemy.specialAttack;
		AIData.refreshWarningTiles = !enemy.usingSpecial;
		enemy.usingSpecial = true;
		if (enemy.Enemy && enemy.Enemy.hitsfxSpecial) AIData.hitsfx = enemy.Enemy.hitsfxSpecial;

		if (enemy.Enemy.specialRemove) AIData.attack = AIData.attack.replace(enemy.Enemy.specialRemove, "");
		if (enemy.Enemy.specialRange && enemy.usingSpecial) {
			AIData.range = enemy.Enemy.specialRange;
		}
		if (enemy.Enemy.specialWidth && enemy.usingSpecial) {
			AIData.width = enemy.Enemy.specialWidth;
		}
		if (enemy.Enemy.specialPower && enemy.usingSpecial) {
			AIData.power = enemy.Enemy.specialPower;
		}
		if (enemy.Enemy.specialDamage && enemy.usingSpecial) {
			AIData.damage = enemy.Enemy.specialDamage;
		}
	}

	AIData.addMoreRestraints = KinkyDungeonStatsChoice.has("NoWayOut") || !AIData.leashing || (AIData.attack.includes("Bind") && (KDBoundPowerLevel < AIData.targetRestraintLevel || !(KinkyDungeonIsArmsBound() || KinkyDungeonIsHandsBound(false, true))));

	if (!enemy.Enemy.attackWhileMoving && AIData.range > AIData.followRange) {
		AIData.followRange = AIData.range;
	}
	if (player.player && enemy.Enemy && enemy.Enemy.playerFollowRange) AIData.followRange = enemy.Enemy.playerFollowRange;

	if (!enemy.warningTiles) enemy.warningTiles = [];
	AIData.canSensePlayer = !AIData.distracted && KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.visionRadius, true, true);
	AIData.canSeePlayer = !AIData.distracted && KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.visionRadius, false, false);
	AIData.canSeePlayerChase = !AIData.distracted && enemy.aware ? KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.chaseRadius, false, false) : false;
	AIData.canSeePlayerMedium = !AIData.distracted && KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.visionRadius/1.4, false, true);
	AIData.canSeePlayerClose = !AIData.distracted && KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.visionRadius/2, false, true);
	AIData.canSeePlayerVeryClose = !AIData.distracted && KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.visionRadius/3, false, true);
	AIData.canShootPlayer = !AIData.distracted && KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.visionRadius, false, true);

	if (KinkyDungeonLastTurnAction && AIData.canSeePlayer) {
		if (!enemy.aggro) enemy.aggro = 0;
		enemy.aggro += KinkyDungeonLastTurnAction == "Struggle" ? 0.1 :
			(KinkyDungeonLastTurnAction == "Spell" ? 0.3 :
				(KinkyDungeonAlert ? 0.1 :
					0.01));
	}

	if (enemy.Enemy.projectileAttack && (!AIData.canShootPlayer || !KinkyDungeonCheckProjectileClearance(enemy.x, enemy.y, player.x, player.y))) AIData.followRange = 1;

	if (!KinkyDungeonAggressive(enemy) && !enemy.Enemy.alwaysHostile && !(enemy.rage > 0) && AIData.canSeePlayer && player.player && !KDAllied(enemy)
		&& ((!KinkyDungeonFlags.has("nojailbreak") && !KinkyDungeonPlayerInCell(true, true)) || KinkyDungeonLastTurnAction == "Struggle" || KinkyDungeonLastAction == "Struggle")) {
		if (enemy.Enemy.tags.jailer || enemy.Enemy.tags.jail) {
			if (KDGameData.PrisonerState == 'parole' && KinkyDungeonPlayer.CanInteract() && !KDEnemyHasFlag(enemy, "Shop")) KinkyDungeonAggroAction('unrestrained', {enemy: enemy});
			else if ((KDGameData.PrisonerState == 'parole' || KDGameData.PrisonerState == 'jail') && (KinkyDungeonLastTurnAction == "Struggle" || KinkyDungeonLastAction == "Struggle")) KinkyDungeonAggroAction('struggle', {enemy: enemy});
			else if ((!KinkyDungeonFlags.has("nojailbreak") && !KinkyDungeonPlayerInCell(true, true)) && KDGameData.PrisonerState == 'jail' && !KDIsPlayerTethered() && KinkyDungeonSlowLevel < 9) KinkyDungeonAggroAction('jailbreak', {enemy: enemy});
		}
		AIData.ignore = !KinkyDungeonAggressive(enemy) && (!enemy.playWithPlayer || !player.player);
	}

	let sneakThreshold = enemy.Enemy.sneakThreshold ? enemy.Enemy.sneakThreshold : 2;
	if (KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "Sneak")) sneakThreshold = Math.max(0.1, sneakThreshold + KinkyDungeonGetBuffedStat(KinkyDungeonPlayerBuffs, "Sneak"));

	AIData.playAllowed = false;
	AIData.startedDialogue = false;
	AIData.playChance = 0.05;
	if (KDGameData.JailKey) AIData.playChance += 0.2;
	if (AIData.playerDist < 1.5) AIData.playChance += 0.1;
	if (enemy.aware) AIData.playChance += 0.1;
	if (KinkyDungeonPlayerDamage && !KinkyDungeonPlayerDamage.unarmed) {
		AIData.playChance += 0.25;
	}
	if (playerItems || KinkyDungeonRedKeys > 0) {
		AIData.playChance += 0.2;
		if (playerItems.length > 6) {
			AIData.playChance += 0.5;
		}
	}
	if (!enemy.personality) enemy.personality = KDGetPersonality(enemy);

	if (AIData.playerDist < enemy.Enemy.visionRadius / 2) AIData.playChance += 0.1;
	if (KDEnemyHasFlag(enemy, "Shop")) AIData.playChance = KDStrictPersonalities.includes(enemy.personality) ?  0.01 : 0;

	if (KDAllied(enemy) || (!KDHostile(enemy) && KDGameData.PrisonerState != "jail" && KDGameData.PrisonerState != "parole" && !KinkyDungeonStatsChoice.has("Submissive"))) AIData.playChance *= 0.07; // Drastically reduced chance to play if not hostile

	let aware = (enemy.vp > sneakThreshold || enemy.aware);
	if (KinkyDungeonCanPlay(enemy) && !KinkyDungeonFlags.get("NPCCombat") && !enemy.Enemy.alwaysHostile && !(enemy.rage > 0) && !(enemy.hostile > 0) && player.player && AIData.canSeePlayer && (aware) && KDEnemyCanTalk(enemy) && !KinkyDungeonInJail()) {
		AIData.playAllowed = true;
		if (!(enemy.playWithPlayerCD > 0) && !(enemy.playWithPlayer > 0) && KDRandom() < AIData.playChance && !KDAllied(enemy)) {
			AIData.playEvent = true;
		}
	}

	// Intent events
	if (enemy.vp < 0.01 && !KDEnemyHasFlag(enemy, "noResetIntent")) {
		KDResetIntent(enemy, AIData);
	}

	if (player.player && AIData.canSeePlayer && aware && !enemy.IntentAction) {
		let event = KDGetIntentEvent(enemy, AIData, AIData.playEvent, KDAllied(enemy), KDHostile(enemy), KinkyDungeonAggressive(enemy));
		if (event) event(enemy, AIData);
	}


	if (KinkyDungeonCanPutNewDialogue() && AIData.playerDist <= KinkyDungeonMaxDialogueTriggerDist && player.player) {
		let WeightTotal = 0;
		let Weights = [];
		for (let e of Object.entries(KDDialogueTriggers)) {
			let trigger = e[1];
			let weight = 0;
			if ((!trigger.blockDuringPlaytime || enemy.playWithPlayer < 1 || !enemy.playWithPlayer)
				&& (!trigger.noAlly || !KDAllied(enemy))
				&& (!trigger.playRequired || AIData.playAllowed)
				&& (!trigger.noCombat || !KinkyDungeonFlags.get("NPCCombat"))
				&& (!trigger.nonHostile || !KinkyDungeonAggressive(enemy))
				&& (!trigger.allowedPrisonStates || trigger.allowedPrisonStates.includes(KDGameData.PrisonerState))
				&& (!trigger.allowedPersonalities || trigger.allowedPersonalities.includes(enemy.personality))
				&& (!trigger.onlyDuringPlay || enemy.playWithPlayer > 0)) {
				let end = false;
				if (trigger.excludeTags) {
					for (let tt of trigger.excludeTags) {
						if (enemy.Enemy.tags[tt]) {
							end = true;
							break;
						}
					}
				}
				if (!end && trigger.requireTags) {
					for (let tt of trigger.requireTags) {
						if (!enemy.Enemy.tags[tt]) {
							end = true;
							break;
						}
					}
				}
				let hastag = !trigger.requireTagsSingle;
				if (!end && trigger.requireTagsSingle) {
					for (let tt of trigger.requireTagsSingle) {
						if (enemy.Enemy.tags[tt]) {
							hastag = true;
							break;
						}
					}
				}
				if (!hastag) end = true;
				if (!end && (!trigger.prerequisite || trigger.prerequisite(enemy, AIData.playerDist))) {
					weight =  trigger.weight(enemy, AIData.playerDist);
				}
			}
			if (weight > 0) {
				Weights.push({t: trigger, weight: WeightTotal});
				WeightTotal += weight;
			}
		}

		let selection = KDRandom() * WeightTotal;

		for (let L = Weights.length - 1; L >= 0; L--) {
			if (selection > Weights[L].weight) {
				KDStartDialog(Weights[L].t.dialogue,enemy.Enemy.name, true, enemy.personality, enemy);
				AIData.startedDialogue = true;
			}
		}
	}

	let intentAction = enemy.IntentAction && KDIntentEvents[enemy.IntentAction] ? KDIntentEvents[enemy.IntentAction] : null;

	if (!KinkyDungeonAggressive(enemy) && player.player && (enemy.playWithPlayer || (intentAction && intentAction.forceattack))) AIData.ignore = false;

	AIData.sneakMult = 0.25;
	if (AIData.canSeePlayerMedium) AIData.sneakMult += 0.45;
	if (AIData.canSeePlayerClose) AIData.sneakMult += 0.25;
	if (AIData.canSeePlayerVeryClose) AIData.sneakMult += 0.5;
	if (KinkyDungeonAlert > 0) AIData.sneakMult += 1;
	if ((AIData.canSensePlayer || AIData.canSeePlayer || AIData.canShootPlayer || AIData.canSeePlayerChase) && KinkyDungeonTrackSneak(enemy, delta * (AIData.sneakMult), player, (AIData.canSensePlayer && !AIData.canShootPlayer) ? 0 : (enemy.Enemy.tags.darkvision ? 0.5 : 1.5))) {
		if (!KDEnemyHasFlag(enemy, "StayHere")) {
			if (KDEnemyHasFlag(enemy, "Defensive")) {
				enemy.gx = KinkyDungeonPlayerEntity.x;
				enemy.gy = KinkyDungeonPlayerEntity.y;
			} else if (!AIData.ignore && (KinkyDungeonAggressive(enemy) || enemy.playWithPlayer || !KDEnemyHasFlag(enemy, "NoFollow"))) {
				enemy.gx = player.x;
				enemy.gy = player.y;
			}
		}
		if (AIData.canSensePlayer || AIData.canSeePlayer || AIData.canShootPlayer) {
			if (!enemy.aware && KinkyDungeonAggressive(enemy)) KDAddThought(enemy.id, "Aware", 3, 3);
			enemy.aware = true;
			if (KDHostile(enemy) && KinkyDungeonAggressive(enemy) && !enemy.rage && !enemy.Enemy.tags.minor && (!(enemy.silence > 0 || enemy.Enemy.tags.gagged) || enemy.Enemy.tags.alwaysAlert)) {
				for (let e of KinkyDungeonEntities) {
					if (KDHostile(e) && KinkyDungeonAggressive(e) && !enemy.rage && e != enemy && KDistChebyshev(e.x - enemy.x, e.y - enemy.y) <= KinkyDungeonEnemyAlertRadius) {
						if (player.player && KDPlayerLight < 1.5) {
							if (!e.aware) {
								KDAddThought(e.id, "Blind", 3, 3);
								e.path = null;
								e.gx = player.x;
								e.gy = player.y;
							}
						} else {
							if (!e.aware) KDAddThought(e.id, "Confused", 3, 3);
							e.aware = true;
						}

					}
				}
			}
		}
	}

	AIData.ignoreRanged = AIData.canShootPlayer && KinkyDungeonAllRestraint().some((r) => {return KDRestraint(r).ignoreSpells;});
	if (AIData.ignoreRanged && AIData.leashing) AIData.followRange = 1;
	if (enemy == KinkyDungeonJailGuard()) AIData.followRange = 1;

	AIData.kite = false;
	AIData.kiteChance = enemy.Enemy.kiteChance ? enemy.Enemy.kiteChance : 0.75;
	if (AIData.canSeePlayer && (!player.player || KinkyDungeonAggressive(enemy)) && enemy.Enemy && enemy.Enemy.kite && !enemy.usingSpecial && (!player.player || KinkyDungeonHasWill(0.1)) && (enemy.attackPoints <= 0 || enemy.Enemy.attackWhileMoving) && AIData.playerDist <= enemy.Enemy.kite && (KDHostile(enemy) || !player.player)) {
		if (!enemy.Enemy.dontKiteWhenDisabled || !(KinkyDungeonStatBlind < 0 || KinkyDungeonStatBind > 0 || KinkyDungeonStatFreeze > 0 || KinkyDungeonSlowMoveTurns > 0 || KDGameData.SleepTurns > 0))
			if (!enemy.Enemy.noKiteWhenHarmless || !AIData.harmless)
				if (AIData.kiteChance >= 1 || KDRandom() < AIData.kiteChance)
					if (!AIData.ignoreRanged)
						AIData.kite = true;
	}

	if (!KinkyDungeonAggressive(enemy) && player.player && (enemy.playWithPlayer || KDAllied(enemy))) AIData.followRange = 1;

	if ((AIType.resetguardposition(enemy, player, AIData)) && (!enemy.gxx || !enemy.gyy)) {
		enemy.gxx = enemy.gx;
		enemy.gyy = enemy.gy;
	}
	// Movement loop

	// If an enemy was trying to attack the player but the player got behind them somehow, they get stunned
	let flanked = KDCheckVulnerableBackstab(enemy);
	if (player.player && flanked && !enemy.stun && !enemy.Enemy.tags.nosurpriseflank) {
		enemy.stun = 1;
	}

	if (!AIData.startedDialogue) {
		if (
			!AIType.beforemove(enemy, player, AIData)
			&& (
				(enemy.Enemy.attackWhileMoving && enemy != KinkyDungeonLeashingEnemy())
				|| AIData.ignore
				|| !(KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.followRange + 0.5, enemy.attackPoints < 1 || !enemy.Enemy.projectileAttack, false) && enemy.aware)
				|| AIData.kite
			)
		) {
			if (!enemy.gx) enemy.gx = enemy.x;
			if (!enemy.gy) enemy.gy = enemy.y;

			AIData.idle = true;
			AIData.patrolChange = false;
			AIData.followPlayer = false;
			AIData.dontFollow = false;

			if (AIType.follower(enemy, player, AIData)) {
				if (KDAllied(enemy) && player.player) {
					if (!KDEnemyHasFlag(enemy, "NoFollow") && !KDEnemyHasFlag(enemy, "StayHere")) {
						AIData.followPlayer = true;
					} else {
						AIData.dontFollow = true;
						if (enemy.gx == player.x && enemy.gy == player.y && !KDEnemyHasFlag(enemy, "StayHere")) {
							//enemy.gx = undefined;
							//enemy.gy = undefined;
						}
					}
				} else {
					if (KDEnemyHasFlag(enemy, "Defensive") && !KDEnemyHasFlag(enemy, "StayHere")) {
						enemy.gx = KinkyDungeonPlayerEntity.x;
						enemy.gy = KinkyDungeonPlayerEntity.y;
					}
					if (KDEnemyHasFlag(enemy, "StayHere") || KDEnemyHasFlag(enemy, "Defensive")) AIData.dontFollow = true;
					if (KDHostile(enemy)) {
						KinkyDungeonSetEnemyFlag(enemy, "StayHere", 0);
						KinkyDungeonSetEnemyFlag(enemy, "Defensive", 0);
					} else if (!KDAllied(enemy)) {
						KinkyDungeonSetEnemyFlag(enemy, "Defensive", 0);
					}
				}
			}

			// try 12 times to find a moveable tile, with some random variance
			if (
				!enemy.Enemy.immobile &&
				AIType.chase(enemy, player, AIData)
				&& !AIData.ignore
				&& !AIData.dontFollow
				&& (enemy.aware || AIData.followPlayer)
				&& AIData.playerDist <= AIData.chaseRadius
				&& (enemy.gx != enemy.x || enemy.gy != enemy.y || enemy.path || enemy.fx || enemy.fy)) {
				//enemy.aware = true;

				for (let T = 0; T < 12; T++) {
					let dir = KDGetDir(enemy, player);
					let splice = false;
					if (T > 2 && T < 8) dir = KinkyDungeonGetDirectionRandom(dir.x * 10, dir.y * 10); // Fan out a bit
					if (T >= 8 || (enemy.path && !AIData.canSeePlayer) || (!AIData.canSeePlayer && !(enemy.Enemy.stopToCast && AIData.canShootPlayer))) {
						if (!enemy.path && (KinkyDungeonAlert || enemy.aware || AIData.canSeePlayer)) {
							if (!AIData.canSeePlayer) {
								if (AIData.canShootPlayer) {
									KDAddThought(enemy.id, "Shoot", 4, 2);
								} else if (AIData.canSensePlayer) {
									KDAddThought(enemy.id, "Sense", 2, 6);
								} else {
									KDAddThought(enemy.id, "Search", 2, 6);
								}
							}
							enemy.path = KinkyDungeonFindPath(enemy.x, enemy.y, player.x, player.y,
								KDEnemyHasFlag(enemy, "blocked"), KDRandom() < 0.5 ? true : false,
								enemy == KinkyDungeonLeashingEnemy() || AIData.ignoreLocks, AIData.MovableTiles,
								undefined, undefined, undefined, enemy, true); // Give up and pathfind
						} if (enemy.path && enemy.path.length > 0 && Math.max(Math.abs(enemy.path[0].x - enemy.x),Math.abs(enemy.path[0].y - enemy.y)) < 1.5) {
							dir = {x: enemy.path[0].x - enemy.x, y: enemy.path[0].y - enemy.y, delta: KDistChebyshev(enemy.path[0].x - enemy.x, enemy.path[0].y - enemy.y)};
							if (!KinkyDungeonNoEnemyExceptSub(enemy.x + dir.x, enemy.y + dir.y, false, enemy)
								|| !AIData.MovableTiles.includes(KinkyDungeonMapGet(enemy.path[0].x, enemy.path[0].y))) {
								enemy.path = undefined;
								KinkyDungeonSetEnemyFlag(enemy, "failpath", 20);
								KinkyDungeonSetEnemyFlag(enemy, "blocked", 5);
							}
							splice = true;
						} else {
							enemy.path = undefined;
							KinkyDungeonSetEnemyFlag(enemy, "failpath", 20);
							if (!AIData.canSensePlayer) {
								if (enemy.aware) KDAddThought(enemy.id, "Lose", 1, 4);
								enemy.aware = false;
							}

							//dir = KinkyDungeonGetDirectionRandom(0, 0); // Random...
						}
					}
					if (dir.delta > 1.5) {
						enemy.path = undefined;
						KinkyDungeonSetEnemyFlag(enemy, "failpath", 20);
					}
					else if (KinkyDungeonEnemyCanMove(enemy, dir, AIData.MovableTiles, AIData.AvoidTiles, AIData.ignoreLocks, T)) {
						if (KinkyDungeonEnemyTryMove(enemy, dir, delta, enemy.x + dir.x, enemy.y + dir.y)) AIData.moved = true;
						if (AIData.moved && splice && enemy.path) enemy.path.splice(0, 1);
						AIData.idle = false;

						// If we moved we will pick a candidate for next turns attempt
						if (AIData.moved) {
							dir = KDGetDir(enemy, player);
							if (KinkyDungeonEnemyCanMove(enemy, dir, AIData.MovableTiles, AIData.AvoidTiles, AIData.ignoreLocks, T)) {
								enemy.fx = enemy.x + dir.x;
								enemy.fy = enemy.y + dir.y;
							}
						}
						break;
					} else {
						enemy.fx = undefined;
						enemy.fy = undefined;
					}
				}
			} else if (!enemy.Enemy.immobile && AIType.move(enemy, player, AIData) && (Math.abs(enemy.x - enemy.gx) > 0 || Math.abs(enemy.y - enemy.gy) > 0))  {
				if (enemy.aware) {
					enemy.path = undefined;
				}
				enemy.aware = false;
				for (let T = 0; T < 8; T++) {
					let dir = KDGetDir(enemy, {x: enemy.gx, y: enemy.gy});
					let splice = false;
					if (T > 2 && T < 8) dir = KinkyDungeonGetDirectionRandom(dir.x * 10, dir.y * 10); // Fan out a bit
					if (T >= 8 || enemy.path || !KinkyDungeonCheckPath(enemy.x, enemy.y, enemy.gx, enemy.gy)) {
						if (!enemy.path) enemy.path = KinkyDungeonFindPath(
							enemy.x, enemy.y, enemy.gx, enemy.gy,
							AIData.playerDist > AIData.chaseRadius, KDRandom() < 0.5 ? true : false,
							enemy == KinkyDungeonLeashingEnemy() || AIData.ignoreLocks, AIData.MovableTiles,
							undefined, undefined, undefined, enemy, true); // Give up and pathfind
						if (enemy.path && enemy.path.length > 0 && Math.max(Math.abs(enemy.path[0].x - enemy.x),Math.abs(enemy.path[0].y - enemy.y)) < 1.5) {
							dir = {x: enemy.path[0].x - enemy.x, y: enemy.path[0].y - enemy.y, delta: KDistChebyshev(enemy.path[0].x - enemy.x, enemy.path[0].y - enemy.y)};
							if (!KinkyDungeonNoEnemyExceptSub(enemy.x + dir.x, enemy.y + dir.y, false, enemy)
								|| !AIData.MovableTiles.includes(KinkyDungeonMapGet(enemy.path[0].x, enemy.path[0].y))) {
								enemy.path = undefined;
								KinkyDungeonSetEnemyFlag(enemy, "failpath", 20);
								KinkyDungeonSetEnemyFlag(enemy, "blocked", 5);
							}
							splice = true;
						} else {
							enemy.path = undefined;
							KinkyDungeonSetEnemyFlag(enemy, "failpath", 20);
						}
					}
					if (dir.delta > 1.5) {enemy.path = undefined;}
					else if (KinkyDungeonEnemyCanMove(enemy, dir, AIData.MovableTiles, AIData.AvoidTiles, AIData.ignoreLocks, T)) {
						if (KinkyDungeonEnemyTryMove(enemy, dir, delta, enemy.x + dir.x, enemy.y + dir.y)) AIData.moved = true;
						if (AIData.moved && splice && enemy.path) enemy.path.splice(0, 1);
						AIData.idle = false;// If we moved we will pick a candidate for next turns attempt
						if (AIData.moved) {
							dir = KDGetDir(enemy, {x: enemy.gx, y: enemy.gy});
							if (KinkyDungeonEnemyCanMove(enemy, dir, AIData.MovableTiles, AIData.AvoidTiles, AIData.ignoreLocks, T)) {
								enemy.fx = enemy.x + dir.x;
								enemy.fy = enemy.y + dir.y;
							}
						}
						break;
					} else {
						enemy.fx = undefined;
						enemy.fy = undefined;
						if (KinkyDungeonPlayerEntity.x == enemy.x + dir.x && KinkyDungeonPlayerEntity.y == enemy.y + dir.y) enemy.path = undefined;
					}
				}
			} else if (Math.abs(enemy.x - enemy.gx) < 2 || Math.abs(enemy.y - enemy.gy) < 2) AIData.patrolChange = true;

			if (!enemy.Enemy.immobile && !AIType.aftermove(enemy, player, AIData)) {
				if (AIType.resetguardposition(enemy, player, AIData) && !AIData.followPlayer && Math.max(Math.abs(enemy.x - enemy.gx), Math.abs(enemy.y - enemy.gy)) < 1.5 && enemy.gxx && enemy.gyy) {
					enemy.gx = enemy.gxx;
					enemy.gy = enemy.gyy;
				}
				let wanderfar = AIType.wander_far(enemy, player, AIData);
				let wandernear = AIType.wander_near(enemy, player, AIData);
				if ((wanderfar || wandernear) && !AIData.followPlayer && (!enemy.Enemy.allied && !KDEnemyHasFlag(enemy, "StayHere")) && !KDEnemyHasFlag(enemy, "StayHere") && enemy.movePoints < 1 && (!enemy.aware || !KinkyDungeonAggressive(enemy))) {
					if ((Math.max(Math.abs(enemy.x - enemy.gx), Math.abs(enemy.y - enemy.gy)) < 1.5 || (KDRandom() < 0.02 && KDEnemyHasFlag(enemy, "failpath"))) || (!(enemy.vp > 0.05) && (!enemy.path || KDRandom() < 0.1))) {
						let master = KinkyDungeonFindMaster(enemy).master;
						if (KDRandom() < 0.1 && !master && wanderfar) {
							// long distance hunt
							let newPoint = KinkyDungeonGetRandomEnemyPoint(false, enemy.tracking && KinkyDungeonHuntDownPlayer && KDGameData.PrisonerState != "parole" && KDGameData.PrisonerState != "jail");
							if (newPoint) {
								enemy.gx = newPoint.x;
								enemy.gy = newPoint.y;
							}
						} else if (wandernear) {
							if (KinkyDungeonAlert && AIData.playerDist < Math.max(4, AIData.visionRadius)) {
								enemy.gx = KinkyDungeonPlayerEntity.x;
								enemy.gy = KinkyDungeonPlayerEntity.y;
							} else {
								// Short distance
								let ex = enemy.x;
								let ey = enemy.y;
								let cohesion = enemy.Enemy.cohesion ? enemy.Enemy.cohesion : 0.5;
								let masterCloseness = enemy.Enemy.cohesion ? enemy.Enemy.cohesion : 0.7;
								if (master && KDRandom() < masterCloseness) {
									ex = master.x;
									ey = master.y;
								} else if (KDRandom() < cohesion) {
									let minDist = enemy.Enemy.cohesionRange ? enemy.Enemy.cohesionRange : AIData.visionRadius;
									for (let e of KinkyDungeonEntities) {
										if (e == enemy) continue;
										if (['guard', 'ambush'].includes(KDGetAI(enemy))) continue;
										if (enemy.Enemy.clusterWith && !e.Enemy.tags[enemy.Enemy.clusterWith]) continue;
										if (KinkyDungeonTiles.get(e.x + "," + e.y) && KinkyDungeonTiles.get(e.x + "," + e.y).OffLimits) continue;
										let dist = KDistEuclidean(e.x - enemy.x, e.y - enemy.y);
										if (dist < minDist) {
											minDist = dist;
											let ePoint = KinkyDungeonGetNearbyPoint(ex, ey, false);
											if (ePoint) {
												ex = ePoint.x;
												ey = ePoint.y;
											}
										}
									}
								}
								let newPoint = KinkyDungeonGetNearbyPoint(ex, ey, false);
								if (newPoint && (KDGetFaction(enemy) != "Player" || !KinkyDungeonPointInCell(newPoint.x, newPoint.y))) {
									if (!AIType.strictwander || KinkyDungeonCheckPath(enemy.x, enemy.y, newPoint.x, newPoint.y)) {
										enemy.gx = newPoint.x;
										enemy.gy = newPoint.y;
									}
								}
							}
						}
					}
				}
			}
		}
	}

	if (enemy.usingSpecial && !enemy.specialCD) enemy.specialCD = 0;

	// Attack loop
	AIData.playerDist = Math.sqrt((enemy.x - player.x)*(enemy.x - player.x) + (enemy.y - player.y)*(enemy.y - player.y));
	if (!(enemy.disarm > 0)
		&& (!enemy.Enemy.followLeashedOnly || KDGameData.KinkyDungeonLeashedPlayer < 1 || KDGameData.KinkyDungeonLeashingEnemy == enemy.id)
		&& ((KDHostile(enemy) || (enemy.playWithPlayer && player.player)) || (!player.player && (!player.Enemy || KDHostile(player) || enemy.rage)))
		&& (((enemy.aware && KinkyDungeonTrackSneak(enemy, 0, player)) || (AIData.playerDist < Math.max(1.5, AIData.blindSight) && enemy.vp >= sneakThreshold*0.7)) || (!KDAllied(enemy) && !KDHostile(enemy)))
		&& !AIData.ignore
		&& (AIData.attack.includes("Melee") || (enemy.Enemy.tags && AIData.leashing && !KinkyDungeonHasWill(0.1)))
		&& (!AIData.ignoreRanged || AIData.playerDist < 1.5)
		&& AIType.attack(enemy, player, AIData)
		&& KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.range + 0.5, !enemy.Enemy.projectileAttack, !enemy.Enemy.projectileAttack)) {//Player is adjacent
		AIData.idle = false;
		enemy.revealed = true;

		let dir = KinkyDungeonGetDirection(player.x - enemy.x, player.y - enemy.y);

		if (!AIData.moved || enemy.Enemy.attackWhileMoving) {
			let moveMult = KDBoundEffects(enemy) * 0.5;
			let attackMult = KinkyDungeonGetBuffedStat(enemy.buffs, "AttackSlow");
			let attackTiles = enemy.warningTiles ? enemy.warningTiles : [dir];
			let ap = (KinkyDungeonMovePoints < 0 && !KinkyDungeonHasWill(0.1) && KDGameData.KinkyDungeonLeashingEnemy == enemy.id) ? enemy.Enemy.movePoints+moveMult+1 : enemy.Enemy.attackPoints + attackMult;
			if (!KinkyDungeonEnemyTryAttack(enemy, player, attackTiles, delta, enemy.x + dir.x, enemy.y + dir.y, (enemy.usingSpecial && enemy.Enemy.specialAttackPoints) ? enemy.Enemy.specialAttackPoints : ap, undefined, undefined, enemy.usingSpecial, AIData.refreshWarningTiles, AIData.attack, AIData.MovableTiles)) {
				if (enemy.warningTiles.length == 0 || (AIData.refreshWarningTiles && enemy.usingSpecial)) {
					let minrange = enemy.Enemy.tilesMinRange ? enemy.Enemy.tilesMinRange : 1;
					if (enemy.usingSpecial && enemy.Enemy.tilesMinRangeSpecial) minrange = enemy.Enemy.tilesMinRangeSpecial;
					if ((!enemy.usingSpecial && enemy.attackPoints > 0) || enemy.specialCD < 1) {
						enemy.fx = player.x;
						enemy.fy = player.y;
						enemy.warningTiles = KinkyDungeonGetWarningTiles(player.x - enemy.x, player.y - enemy.y, AIData.range, AIData.width, minrange);
						let playerIn = false;
						for (let tile of enemy.warningTiles) {
							if (KinkyDungeonPlayerEntity.x == enemy.x + tile.x && KinkyDungeonPlayerEntity.y == enemy.y + tile.y) {playerIn = true; break;}
						}
						if (!playerIn) {
							enemy.fx = player.x;
							enemy.fy = player.y;
						}
					}
					if (AIData.refreshWarningTiles && enemy.usingSpecial) enemy.attackPoints = Math.min(enemy.attackPoints, delta);
				} else {
					let playerIn = false;
					for (let tile of enemy.warningTiles) {
						if (player.x == enemy.x + tile.x && player.y == enemy.y + tile.y) {playerIn = true; break;}
					}
					if (!playerIn) {
						if (enemy.Enemy.specialRange && enemy.usingSpecial && enemy.Enemy.specialCDonAttack) {
							enemy.specialCD = enemy.Enemy.specialCD;
							if (enemy.Enemy.stunOnSpecialCD) enemy.stun = enemy.Enemy.stunOnSpecialCD;
							if (AIData.attack.includes("Dash") && enemy.Enemy.dashOnMiss) {
								KDDash(enemy, player, AIData.MovableTiles);
							}
						}
						if (enemy.Enemy.specialWidth && enemy.usingSpecial && enemy.Enemy.specialCDonAttack) {
							enemy.specialCD = enemy.Enemy.specialCD;
							if (enemy.Enemy.stunOnSpecialCD) enemy.stun = enemy.Enemy.stunOnSpecialCD;
							if (AIData.attack.includes("Dash") && enemy.Enemy.dashOnMiss) {
								KDDash(enemy, player, AIData.MovableTiles);
							}
						}
					}
				}

				let playerEvasion = (player.player) ? KinkyDungeonPlayerEvasion()
					: KinkyDungeonMultiplicativeStat(((player.Enemy && player.Enemy.evasion) ? player.Enemy.evasion : 0)) * KinkyDungeonMultiplicativeStat(KinkyDungeonGetBuffedStat(player.buffs, "Evasion"));
				if (AIData.playerDist < 1.5 && player.player && AIData.attack.includes("Bind") && enemy.Enemy.bound && KDRandom() * AIData.accuracy <= playerEvasion && KinkyDungeonMovePoints > -1 && KinkyDungeonTorsoGrabCD < 1 && KinkyDungeonLastAction == "Move") {
					let caught = false;
					for (let tile of enemy.warningTiles) {
						if (enemy.x + tile.x == player.x && enemy.y + tile.y == player.y) {
							caught = true;
							break;
						}
					}
					if (caught) {
						let harnessChance = 0;
						let harnessRestraintName = "";
						let list = KinkyDungeonAllRestraint();
						let list2 = [];
						for (let restraint of list) {
							if (KDRestraint(restraint) && KDRestraint(restraint).harness) {
								harnessChance += 1;
								list2.push(KDRestraint(restraint).name);
							}
						}
						let rest = list2[Math.floor(KDRandom() * list2.length)];
						if (rest) harnessRestraintName = rest;

						if (harnessChance > 0) {
							let roll = KDRandom();
							let bonus = 0;
							if (!KinkyDungeonCanStand()) bonus += KinkyDungeonTorsoGrabChanceBonus;
							if (KinkyDungeonStatWill < 0.01) bonus += KinkyDungeonTorsoGrabChanceBonus;
							for (let T = 0; T < harnessChance; T++) {
								roll = Math.min(roll, KDRandom());
							}
							if (roll < KinkyDungeonTorsoGrabChance + bonus) {
								KinkyDungeonMovePoints = -1;
								let msg = TextGet("KinkyDungeonTorsoGrab").replace("RestraintName", TextGet("Restraint" + harnessRestraintName)).replace("EnemyName", TextGet("Name" + enemy.Enemy.name));

								KinkyDungeonSendTextMessage(5, msg, "yellow", 1);

								if (KDRandom() < actionDialogueChance)
									KinkyDungeonSendDialogue(enemy, TextGet("KinkyDungeonRemindJail" + (enemy.Enemy.playLine ? enemy.Enemy.playLine : "") + "Grab").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), KDGetColor(enemy), 2, 4);

								KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/Grab.ogg", enemy);
								KinkyDungeonTorsoGrabCD = 2;
							}
						}
					}
				}
			} else { // Attack lands!
				enemy.revealed = true;
				let hit = ((enemy.usingSpecial && enemy.Enemy.specialAttackPoints) ? enemy.Enemy.specialAttackPoints : ap) <= 1;
				for (let tile of enemy.warningTiles) {
					if (enemy.x + tile.x == player.x && enemy.y + tile.y == player.y) {
						hit = true;
						break;
					}
				}

				let playerEvasion = (player.player) ? KinkyDungeonPlayerEvasion()
					: KinkyDungeonMultiplicativeStat(((player.Enemy && player.Enemy.evasion) ? player.Enemy.evasion : 0)) * KinkyDungeonMultiplicativeStat(KinkyDungeonGetBuffedStat(player.buffs, "Evasion"));

				if (hit) {
					if (player.player) {
						KinkyDungeonTickBuffTag(KinkyDungeonPlayerBuffs, "incomingHit", 1);
					} else
						KinkyDungeonTickBuffTag(player.buffs, "incomingHit", 1);
				}

				let missed = KDRandom() > playerEvasion * AIData.accuracy;
				let preData = {
					attack: AIData.attack,
					enemy: enemy,
					damagetype: AIData.damage,
					attacker: enemy,
					target: player,
					missed: missed,
					hit: hit,
				};
				KinkyDungeonSendEvent("beforeAttack", preData);

				if (hit && missed) {
					if (player.player) {
						KinkyDungeonSendEvent("miss", {enemy: enemy});
						KinkyDungeonSendTextMessage(2, TextGet("KinkyDungeonAttackMiss").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), "lightgreen", 1);

						if (KDRandom() < actionDialogueChance)
							KinkyDungeonSendDialogue(enemy, TextGet("KinkyDungeonRemindJail" + (enemy.Enemy.playLine ? enemy.Enemy.playLine : "") + "Miss").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), KDGetColor(enemy), 4, 4);
					}
					KDAddThought(enemy.id, "Annoyed", 4, 1);
					enemy.vulnerable = Math.max(enemy.vulnerable, 1);
					hit = false;
				}
				if (hit) {
					if (KDRandom() < actionDialogueChanceIntense)
						KinkyDungeonSendDialogue(enemy, TextGet("KinkyDungeonRemindJail" + (enemy.Enemy.playLine ? enemy.Enemy.playLine : "") + "HitPlayer").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), KDGetColor(enemy), 3, 5);
					let replace = [];
					let restraintAdd = [];
					let willpowerDamage = 0;
					let msgColor = "yellow";
					let Locked = false;
					let Stun = false;
					let Blind = false;
					let priorityBonus = 0;
					let addedRestraint = false;

					let happened = 0;
					let bound = 0;

					if (player.player) {
						if (player.player && AIData.playerDist < AIData.range + 0.5 && (KinkyDungeonAggressive(enemy) || AIData.attack.includes("Pull") || enemy.IntentLeashPoint) && (((!enemy.Enemy.noLeashUnlessExhausted || !KinkyDungeonHasWill(0.1)) && enemy.Enemy.tags && AIData.leashing && KDGetFaction(enemy) != "Ambush") || AIData.attack.includes("Pull") || enemy.IntentLeashPoint) && (KDGameData.KinkyDungeonLeashedPlayer < 1 || KDGameData.KinkyDungeonLeashingEnemy == enemy.id)) {
							AIData.intentToLeash = true;

							let wearingLeash = false;
							if (!wearingLeash && !AIData.attack.includes("Pull"))
								wearingLeash = KinkyDungeonIsWearingLeash();
							AIData.leashed = wearingLeash || AIData.attack.includes("Pull");

							if (AIData.leashed) {

								let leashToExit = AIData.leashing && !KinkyDungeonHasWill(0.1) && AIData.playerDist < 1.5;

								AIData.nearestJail = KinkyDungeonNearestJailPoint(enemy.x, enemy.y);
								if (KinkyDungeonFlags.has("LeashToPrison")) AIData.nearestJail = Object.assign({type: "jail", radius: 1}, KinkyDungeonStartPosition);
								let leashPos = AIData.nearestJail;
								let findMaster = undefined;
								if (!leashToExit && enemy.Enemy.pullTowardSelf && (Math.abs(player.x - enemy.x) > 1.5 || Math.abs(player.y - enemy.y) > 1.5)) {
									findMaster = enemy;
									if (findMaster) leashPos = {x: findMaster.x, y: findMaster.y, type: "", radius: 1};
								} else {
									if (AIData.attack.includes("Pull") && enemy.Enemy.master) {
										/*let masterDist = 1000;
										for (let e of KinkyDungeonEntities) {
											let dist = Math.sqrt((e.x - enemy.x) * (e.x - enemy.x) + (e.y - enemy.y)*(e.y - enemy.y));
											if ((!enemy.Enemy.master.maxDist || dist < enemy.Enemy.master.maxDist)
												&& dist < masterDist
												&& (!enemy.Enemy.master.loose || KinkyDungeonCheckLOS(enemy, e, dist, 100, false))) {
												masterDist = Math.sqrt((e.x - enemy.x) * (e.x - enemy.x) + (e.y - enemy.y)*(e.y - enemy.y));
												findMaster = e;
											}
										}*/
										let fm = KinkyDungeonFindMaster(enemy);
										findMaster = fm.master;
										if (findMaster) leashPos = {x: findMaster.x, y: findMaster.y, type: "", radius: 1};
									}
								}

								if (enemy.IntentLeashPoint) leashPos = enemy.IntentLeashPoint;

								if (AIData.playerDist < 1.5 || !KinkyDungeonGetRestraintItem("ItemDevices"))
									AIData.leashPos = leashPos;
							}
						}

						if (AIData.attack.includes("Lock") && KinkyDungeonPlayerGetLockableRestraints().length > 0) {
							let Lockable = KinkyDungeonPlayerGetLockableRestraints();
							let Lstart = 0;
							let Lmax = Lockable.length-1;
							if (!enemy.Enemy.attack.includes("LockAll")) {
								Lstart = Math.floor(Lmax*KDRandom()); // Lock one at random
							}
							for (let L = Lstart; L <= Lmax; L++) {
								let l = enemy.Enemy.attackLock ? enemy.Enemy.attackLock : KinkyDungeonGenerateLock(true);
								KinkyDungeonLock(Lockable[L], l); // Lock it!
								priorityBonus += KDRestraint(Lockable[L]).power;
							}
							Locked = true;
							happened += 1;
							if (enemy.usingSpecial && Locked && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Lock")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							if (KDRandom() < actionDialogueChanceIntense)
								KinkyDungeonSendDialogue(enemy, TextGet("KinkyDungeonRemindJail" + (enemy.Enemy.playLine ? enemy.Enemy.playLine : "") + "Lock").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), KDGetColor(enemy), 2, 4);

						} else if (AIData.attack.includes("Bind")
							&& ((!enemy.usingSpecial && !enemy.Enemy.bindOnDisable) || (enemy.usingSpecial && !enemy.Enemy.bindOnDisableSpecial) || !KinkyDungeonHasWill(0.01) || !KinkyDungeonHasStamina(2.5) || KinkyDungeonPlayer.Pose.includes("Kneel") || KinkyDungeonPlayer.Pose.includes("Hogtie"))) {

							if (AIData.addMoreRestraints || AIData.addLeash) {
								if (!AIData.intentToLeash && enemy.Enemy.bound && KinkyDungeonTiles.get(KinkyDungeonPlayerEntity.x + "," + KinkyDungeonPlayerEntity.y) && KDGameData.KinkyDungeonLeashedPlayer < 1
									&& KinkyDungeonTiles.get(KinkyDungeonPlayerEntity.x + "," + KinkyDungeonPlayerEntity.y).Furniture == "Cage"
									&& !KinkyDungeonPlayerTags.has("Furniture")) {
									let rest = KinkyDungeonGetRestraint(
										{tags: ["cage"]}, MiniGameKinkyDungeonLevel,
										KinkyDungeonMapIndex[MiniGameKinkyDungeonCheckpoint],
										true,
										"",
										true,
										false,
										false);
									replace.push({keyword:"RestraintAdded", value: TextGet("Restraint" + rest.name)});
									restraintAdd.push(rest);
									addedRestraint = true;
								} else {
									let numTimes = 1;
									if (enemy.Enemy.multiBind) numTimes = enemy.Enemy.multiBind;
									for (let times = 0; times < numTimes; times++) {
										// Note that higher power enemies get a bonus to the floor restraints appear on
										let rest = KinkyDungeonGetRestraint(
											enemy.Enemy, MiniGameKinkyDungeonLevel,
											KinkyDungeonMapIndex[MiniGameKinkyDungeonCheckpoint],
											enemy.Enemy.bypass,
											enemy.Enemy.useLock ? enemy.Enemy.useLock : "",
											!enemy.Enemy.ignoreStaminaForBinds && !AIData.attack.includes("Suicide"),
											!AIData.addMoreRestraints && AIData.addLeash,
											KinkyDungeonStatsChoice.has("TightRestraints") || enemy.Enemy.tags.miniboss || enemy.Enemy.tags.boss,
											enemy.Enemy.bound ? KDExtraEnemyTags : undefined);
										if (rest) {
											replace.push({keyword:"RestraintAdded", value: TextGet("Restraint" + rest.name)});
											restraintAdd.push(rest);
											addedRestraint = true;
										}
									}
									if (enemy.usingSpecial && addedRestraint && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Bind")) {
										enemy.specialCD = enemy.Enemy.specialCD;
									}
									if (!addedRestraint && enemy.Enemy.fullBoundBonus) {
										willpowerDamage += enemy.Enemy.fullBoundBonus; // Some enemies deal bonus damage if they cannot put a binding on you
									}
								}
							} else if (enemy.Enemy.fullBoundBonus) {
								willpowerDamage += enemy.Enemy.fullBoundBonus; // Some enemies deal bonus damage if they cannot put a binding on you
							}
						}
					}
					if (AIData.attack.includes("Bind") && KDGameData.KinkyDungeonLeashedPlayer < 1 && !enemy.Enemy.nopickpocket && player.player && enemy.Enemy.bound && !KDGameData.JailKey && KDCanPickpocket(enemy)) {
						let item = playerItems.length > 0 ? playerItems[Math.floor(KDRandom() * playerItems.length)] : undefined;
						let picked = false;
						if (item && playerItems.length > 0
							&& KinkyDungeonIsArmsBound() && ((!KinkyDungeonPlayerDamage || item.name != KinkyDungeonPlayerDamage.name) || KinkyDungeonStatStamina < KinkyDungeonStatStaminaMax * 0.05) && KDRandom() < 0.5) {
							if (item.type == Weapon) {
								KinkyDungeonInventoryRemove(item);
								//KinkyDungeonAddLostItems([item], false);
								if (!enemy.items) enemy.items = [item.name];
								enemy.items.push(item.name);
							} else if (item.type == Consumable) {
								KinkyDungeonChangeConsumable(KinkyDungeonConsumables[item.name], -1);
								/** @type {item} */
								let item2 = Object.assign({}, item);
								//KinkyDungeonAddLostItems([item2], false);
								item2.quantity = 1;
								if (!enemy.items) enemy.items = [item.name];
								enemy.items.push(item.name);
							}
							if (item) {
								KinkyDungeonSendActionMessage(10, TextGet("KinkyDungeonStealItem").replace("ITEMSTOLEN", TextGet("KinkyDungeonInventoryItem" + item.name)), "yellow", 2);
								picked = true;
							}
						} else if (KinkyDungeonLockpicks > 0 && KDRandom() < 0.5) {
							KinkyDungeonLockpicks -= 1;
							KinkyDungeonSendActionMessage(8, TextGet("KinkyDungeonStealPick"), "yellow", 2);
							if (!enemy.items) enemy.items = ["Pick"];
							enemy.items.push("Pick");
							picked = true;
						} else if (KinkyDungeonRedKeys > 0) {
							KinkyDungeonRedKeys -= 1;
							KinkyDungeonSendActionMessage(8, TextGet("KinkyDungeonStealRedKey"), "yellow", 2);
							if (!enemy.items) enemy.items = ["RedKey"];
							enemy.items.push("RedKey");
							picked = true;
						} else if (KinkyDungeonBlueKeys > 0) {
							KinkyDungeonBlueKeys -= 1;
							KinkyDungeonSendActionMessage(8, TextGet("KinkyDungeonStealBlueKey"), "yellow", 2);
							if (!enemy.items) enemy.items = ["BlueKey"];
							enemy.items.push("BlueKey");
							picked = true;
						}
						/*else if (KinkyDungeonEnchantedBlades > 0 && KDRandom() < 0.5) {
							KinkyDungeonEnchantedBlades -= 1;
							KinkyDungeonSendActionMessage(8, TextGet("KinkyDungeonStealEnchKnife"), "yellow", 2);
							if (!enemy.items) enemy.items = ["EnchKnife"];
							enemy.items.push("knife");
						}*/
						if (picked) {
							KinkyDungeonSetFlag("pickpocket", 4);
							KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/Miss.ogg", enemy);
							if (KDRandom() < actionDialogueChanceIntense)
								KinkyDungeonSendDialogue(enemy, TextGet("KinkyDungeonRemindJail" + (enemy.Enemy.playLine ? enemy.Enemy.playLine : "") + "Pickpocket").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), KDGetColor(enemy), 2, 1);

						}
					}

					if (AIData.attack.includes("Suicide")) {
						if ((!enemy.Enemy.suicideOnAdd && !enemy.Enemy.suicideOnLock)
							|| (enemy.Enemy.suicideOnAdd && addedRestraint) || (enemy.Enemy.suicideOnLock && Locked) || (!player.player && AIData.attack.includes("Bind") && enemy.Enemy.suicideOnAdd)) {
							enemy.hp = 0;
						} else if ((!KinkyDungeonHasWill(0.1) || (enemy.Enemy.Attack?.mustBindorFail)) && enemy.Enemy.failAttackflag) {
							for (let f of enemy.Enemy.failAttackflag) {
								KinkyDungeonSetFlag(f, 12);
							}
						}
					}
					if (AIData.attack.includes("Vibe")) {
						AIData.vibe = true;
					}
					if (AIData.intentToLeash) {
						let leashPos = AIData.leashPos;
						if (AIData.leashPos) {
							if (leashPos && leashPos == enemy.IntentLeashPoint && Math.abs(enemy.x - leashPos.x) <= 1.5 && Math.abs(enemy.y - leashPos.y) <= 1.5) {
								if (enemy.IntentAction && KDIntentEvents[enemy.IntentAction] && KDIntentEvents[enemy.IntentAction].arrive) {
									KDIntentEvents[enemy.IntentAction].arrive(enemy, AIData);
								} else {
									KDResetIntent(enemy, AIData);
								}
							}
							else if (AIData.nearestJail && leashPos == AIData.nearestJail && Math.abs(enemy.x - leashPos.x) <= 1 && Math.abs(enemy.y - leashPos.y) <= 1) {
								AIData.defeat = true;
								KDGameData.KinkyDungeonLeashedPlayer = 3 + ap * 2;
								KDGameData.KinkyDungeonLeashingEnemy = enemy.id;
								KDBreakTether();
							}
							else if (leashPos && (Math.abs(enemy.x - leashPos.x) > 1.5 || Math.abs(enemy.y - leashPos.y) > 1.5)) {
								if (!KinkyDungeonHasWill(0.1) && KDRandom() < 0.25) KinkyDungeonMovePoints = -1;
								// Leash pullback
								if (AIData.playerDist < 1.5) {
									let path = KinkyDungeonFindPath(enemy.x, enemy.y, leashPos.x, leashPos.y, false, false, true, KinkyDungeonMovableTilesSmartEnemy, undefined, undefined, undefined, enemy);
									if (path && path.length > 0) {
										let leashPoint = path[0];
										let enemySwap = KinkyDungeonEnemyAt(leashPoint.x, leashPoint.y);
										if ((!enemySwap || !enemySwap.Enemy.noDisplace) && Math.max(Math.abs(leashPoint.x - enemy.x), Math.abs(leashPoint.y - enemy.y)) <= 1.5) {
											KDGameData.KinkyDungeonLeashedPlayer = 3 + ap * 2;
											KDGameData.KinkyDungeonLeashingEnemy = enemy.id;
											if (enemySwap) {
												enemySwap.x = KinkyDungeonPlayerEntity.x;
												enemySwap.y = KinkyDungeonPlayerEntity.y;
												enemySwap.warningTiles = [];
											}
											if (AIData.leashing)
												KinkyDungeonAttachTetherToEntity(2.5, enemy);
											KDMovePlayer(enemy.x, enemy.y, false);
											KinkyDungeonTargetTile = null;
											KinkyDungeonTargetTileLocation = "";
											KDMoveEntity(enemy, leashPoint.x, leashPoint.y, true);
											AIData.hitsfx = "Struggle";
											for (let inv of KinkyDungeonAllRestraint()) {
												if (KDRestraint(inv).removeOnLeash) {
													KinkyDungeonRemoveRestraint(KDRestraint(inv).Group, false);
													if (KDRestraint(inv).Group == "ItemDevices") {
														KinkyDungeonSetFlag("Released", 24);
														KinkyDungeonSetFlag("nojailbreak", 10);
													}
												}
											}
											if (!KinkyDungeonHasWill(0.1)) {
												KinkyDungeonSlowMoveTurns = (enemy.Enemy.movePoints + moveMult - 1) || 0;
												KinkyDungeonSleepTime = CommonTime() + 200;
											}
											KinkyDungeonSetFlag("nojailbreak", KDGameData.KinkyDungeonLeashedPlayer);
											if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Pull")) {
												enemy.specialCD = enemy.Enemy.specialCD;
											}
											if (KinkyDungeonMapGet(enemy.x, enemy.y) == 'D')  {
												KinkyDungeonMapSet(enemy.x, enemy.y, 'd');
												if (KinkyDungeonTiles.get(enemy.x + ',' +enemy.y) && KinkyDungeonTiles.get(enemy.x + ',' +enemy.y).Type == "Door")
													KinkyDungeonTiles.get(enemy.x + ',' +enemy.y).Lock = undefined;
											}

											if (KDRandom() < actionDialogueChanceIntense)
												KinkyDungeonSendDialogue(enemy, TextGet("KinkyDungeonRemindJail" + (enemy.Enemy.playLine ? enemy.Enemy.playLine : "") + "Leash").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), KDGetColor(enemy), 2, 3);
											if (!KinkyDungeonSendTextMessage(6, TextGet("KinkyDungeonLeashGrab").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), "yellow", 1))
												KinkyDungeonSendActionMessage(1, TextGet("KinkyDungeonLeashGrab").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), "yellow", 1);
										}
									}
								} else {
									// Simple pull
									let path = KinkyDungeonFindPath(player.x, player.y, leashPos.x, leashPos.y, true, false, false, KinkyDungeonMovableTilesEnemy, undefined, undefined, undefined, enemy);
									let pullDist = enemy.Enemy.pullDist ? enemy.Enemy.pullDist : 1;
									if (path && path.length > 0) {
										let leashPoint = path[Math.min(Math.max(0,path.length-2), Math.floor(Math.max(0, pullDist-1)))];
										if (!KinkyDungeonEnemyAt(leashPoint.x, leashPoint.y)
											&& Math.sqrt((leashPoint.x - enemy.x) * (leashPoint.x - enemy.x) + (leashPoint.y - enemy.y) * (leashPoint.y - enemy.y)) < AIData.playerDist
											&& Math.sqrt((leashPoint.x - player.x) * (leashPoint.x - player.x) + (leashPoint.y - player.y) * (leashPoint.y - player.y)) <= pullDist * 1.45) {
											if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Pull")) {
												enemy.specialCD = enemy.Enemy.specialCD;
											}
											KDGameData.KinkyDungeonLeashedPlayer = 2;
											KDGameData.KinkyDungeonLeashingEnemy = enemy.id;
											player.x = leashPoint.x;
											player.y = leashPoint.y;
											let msg = "KinkyDungeonLeashGrab";
											if (enemy.Enemy.pullMsg) msg = "Attack" + enemy.Enemy.name + "Pull";

											if (KDRandom() < actionDialogueChanceIntense)
												KinkyDungeonSendDialogue(enemy, TextGet("KinkyDungeonRemindJail" + (enemy.Enemy.playLine ? enemy.Enemy.playLine : "") + "Pull").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), KDGetColor(enemy), 2, 3);
											if (!KinkyDungeonSendTextMessage(8, TextGet(msg).replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), "yellow", 1))
												KinkyDungeonSendActionMessage(3, TextGet(msg).replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), "yellow", 1);
										}
									}
								}
							}
						}
					}
					let Dash = false;
					let data = {};
					if (AIData.attack.includes("Dash") && (enemy.Enemy.dashThruWalls || AIData.canSeePlayer)) {
						let d = KDDash(enemy, player, AIData.MovableTiles);
						Dash = d.Dash;
						happened += d.happened;
					}
					if (AIData.attack.includes("Will") || willpowerDamage > 0) {
						if (willpowerDamage == 0)
							willpowerDamage += AIData.power;
						let buffdmg = KinkyDungeonGetBuffedStat(enemy.buffs, "AttackDmg");
						if (buffdmg) willpowerDamage = Math.max(0, willpowerDamage + buffdmg);
						msgColor = "#ff8888";
						if (enemy.usingSpecial && willpowerDamage > 0 && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Will")) {
							enemy.specialCD = enemy.Enemy.specialCD;
						}
					}
					if (player.player) {
						KinkyDungeonTickBuffTag(enemy.buffs, "hit", 1);
						if (restraintAdd && restraintAdd.length > 0) {
							let restraintblock = KinkyDungeonGetPlayerStat("RestraintBlock");
							let restraintpower = 0;
							for (let r of restraintAdd) {
								restraintpower += r.power;
							}
							restraintblock = KDRestraintBlockPower(restraintblock, restraintpower + (enemy.Enemy.power || 0));
							if (!restraintblock || KDRandom() < restraintblock) {
								for (let r of restraintAdd) {
									let bb =  KinkyDungeonAddRestraintIfWeaker(r, AIData.power, enemy.Enemy.bypass, enemy.Enemy.useLock ? enemy.Enemy.useLock : undefined, undefined, undefined, undefined, KDGetFaction(enemy)) * 2;
									if (bb) {
										KDSendStatus('bound', r.name, "enemy_" + enemy.Enemy.name);
									}
									bound += bb;
								}
							} else {
								KDDamageQueue.push({floater: TextGet("KDBlockedRestraint"), Entity: {x: enemy.x - 0.5, y: enemy.y - 0.5}, Color: "white", Time: 2, Delay: 0});
								bound += 1;
								if (willpowerDamage == 0)
									willpowerDamage += AIData.power;
							}
						}


						if (AIData.attack.includes("Slow")) {
							KinkyDungeonMovePoints = Math.max(KinkyDungeonMovePoints - 2, -1);
							if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Slow")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							happened += 1;
						}
						if (AIData.attack.includes("Effect") && enemy.Enemy.effect) {
							let affected = KinkyDungeonPlayerEffect(enemy.Enemy.effect.damage, enemy.Enemy.effect.effect, enemy.Enemy.effect.spell, KDGetFaction(enemy));
							if (affected && enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Effect")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							happened += 1;
						}
						if (AIData.attack.includes("Stun")) {
							let time = enemy.Enemy.stunTime ? enemy.Enemy.stunTime : 1;
							KinkyDungeonStatBlind = Math.max(KinkyDungeonStatBlind, time);
							KinkyDungeonMovePoints = Math.max(Math.min(-1, -time+1), KinkyDungeonMovePoints-time); // This is to prevent stunlock while slowed heavily
							if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Stun")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							happened += 1;
							priorityBonus += 3*time;
							Stun = true;
							if (KDRandom() < actionDialogueChanceIntense)
								KinkyDungeonSendDialogue(enemy, TextGet("KinkyDungeonRemindJail" + (enemy.Enemy.playLine ? enemy.Enemy.playLine : "") + "Stun").replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), KDGetColor(enemy), 2, 3);

						}
						if (AIData.attack.includes("Blind")) {
							let time = enemy.Enemy.blindTime ? enemy.Enemy.blindTime : 1;
							KinkyDungeonStatBlind = Math.max(KinkyDungeonStatBlind, time);
							if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Blind")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							happened += 1;
							priorityBonus += 3*time;
							Blind = true;
						}
						happened += bound;

						data = {
							attack: AIData.attack,
							enemy: enemy,
							bound: bound,
							damage: willpowerDamage,
							damagetype: AIData.damage,
							restraintsAdded: restraintAdd,
							attacker: enemy,
							target: player,
						};
						KinkyDungeonSendEvent("beforeDamage", data);
						let dmg = KinkyDungeonDealDamage({damage: data.damage, type: data.damagetype});
						happened += dmg.happened;
						KinkyDungeonSetFlag("NPCCombat",  3);

						replace.push({keyword:"DamageTaken", value: dmg.string});
					} else { // if (KDRandom() <= playerEvasion)
						if (AIData.attack.includes("Slow")) {
							if (player.movePoints)
								player.movePoints = Math.max(player.movePoints - 1, 0);
							if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Slow")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							happened += 1;
						}
						if (AIData.attack.includes("Stun")) {
							let time = enemy.Enemy.stunTime ? enemy.Enemy.stunTime : 1;
							if (!player.stun) player.stun = time;
							else player.stun = Math.max(time, player.stun);
							if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Stun")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							happened += 1;
						}
						if (AIData.attack.includes("Blind")) {
							let time = enemy.Enemy.blindTime ? enemy.Enemy.blindTime : 1;
							if (!player.blind) player.blind = time;
							else player.blind = Math.max(time, player.blind);
							if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Blind")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							happened += 1;
						}
						if (AIData.attack.includes("Silence")) {
							let time = enemy.Enemy.silenceTime ? enemy.Enemy.silenceTime : 1;
							KDSilenceEnemy(player, time);
							if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Blind")) {
								enemy.specialCD = enemy.Enemy.specialCD;
							}
							happened += 1;
						}


						let dmg = AIData.power;
						let buffdmg = KinkyDungeonGetBuffedStat(enemy.buffs, "AttackDmg");
						if (buffdmg) dmg = Math.max(0, dmg + buffdmg);
						if (enemy.Enemy.fullBoundBonus) {
							dmg += enemy.Enemy.fullBoundBonus; // Some enemies deal bonus damage if they cannot put a binding on you
						}
						happened += KinkyDungeonDamageEnemy(player, {type: enemy.Enemy.dmgType, damage: dmg}, false, true, undefined, undefined, enemy);
						KinkyDungeonSetFlag("NPCCombat",  3);
						KinkyDungeonTickBuffTag(enemy.buffs, "hit", 1);
						if (happened > 0) {
							// Decrement play timer on a hit, less if they are on furniture
							if (enemy.playWithPlayer) {
								enemy.playWithPlayer = Math.max(0, enemy.playWithPlayer - (!KinkyDungeonPlayerTags.has("Furniture") ? 2 : 1) * Math.max(1, ((enemy.usingSpecial && enemy.Enemy.specialAttackPoints) ? enemy.Enemy.specialAttackPoints : enemy.Enemy.attackPoints))); // Decrement each attack....
								if (enemy.playWithPlayer == 0) KDResetIntent(enemy, AIData);
							}
							let sfx = (AIData.hitsfx) ? AIData.hitsfx : "DealDamage";
							KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/" + sfx + ".ogg", enemy);
						}
					}

					if (enemy.usingSpecial && enemy.specialCD > 0 && enemy.Enemy.specialCharges) {
						if (enemy.specialCharges == undefined) enemy.specialCharges = enemy.Enemy.specialCharges-1;
						else enemy.specialCharges -= 1;
					}

					if (happened > 0 && player.player) {
						let suffix = "";
						if (Stun) suffix = "Stun";
						else if (Blind) suffix = "Blind";
						else if (Locked) suffix = "Lock";
						else if (bound > 0) suffix = "Bind";
						if (Dash) suffix = "Dash";

						let sfx = (AIData.hitsfx) ? AIData.hitsfx : (data.damage > 1 ? "Damage" : "DamageWeak");
						if (enemy.usingSpecial && enemy.Enemy.specialsfx) sfx = enemy.Enemy.specialsfx;
						KinkyDungeonSendEvent("hit", data);
						KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/" + sfx + ".ogg", enemy);
						let text = TextGet("Attack"+enemy.Enemy.name + suffix);
						if (replace)
							for (let R = 0; R < replace.length; R++)
								text = text.replace(replace[R].keyword, "" + replace[R].value);
						KinkyDungeonSendTextMessage(happened+priorityBonus, text, msgColor, 1);
						if (!enemy.Enemy.tags.temporary && AIData.attack.includes("Bind") && KDCanPickpocket(enemy))
							KinkyDungeonLoseJailKeys(true, undefined, enemy);
					}
				} else {
					let sfx = (enemy.Enemy && enemy.Enemy.misssfx) ? enemy.Enemy.misssfx : "Miss";
					KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/" + sfx + ".ogg", enemy);
					enemy.vulnerable = Math.max(enemy.vulnerable, 1);
					if (AIData.attack.includes("Dash") && enemy.Enemy.dashOnMiss) {
						KDDash(enemy, player, AIData.MovableTiles);
					}
				}

				KinkyDungeonTickBuffTag(enemy.buffs, "damage", 1);

				enemy.warningTiles = [];
				if (enemy.usingSpecial) enemy.usingSpecial = false;
			}
		} else {
			enemy.warningTiles = [];
			enemy.attackPoints = 0;
			if (enemy.usingSpecial) enemy.usingSpecial = false;
			enemy.fx = enemy.x + dir.x;
			enemy.fy = enemy.y + dir.y;
		}
	} else {
		enemy.warningTiles = [];
		enemy.attackPoints = 0;
	}

	enemy.moved = (AIData.moved || enemy.movePoints > 0);
	enemy.idle = AIData.idle && !(AIData.moved || enemy.attackPoints > 0);
	if (enemy.idle) {
		enemy.fx = undefined;
		enemy.fy = undefined;
	}


	if (!AIType.afteridle || !AIType.afteridle(enemy, player, AIData)) {
		// Spell loop
		if ((!enemy.Enemy.enemyCountSpellLimit || KinkyDungeonEntities.length < enemy.Enemy.enemyCountSpellLimit)
		&& ((!player.player || (KinkyDungeonAggressive(enemy) || (KDGameData.PrisonerState == 'parole' && enemy.Enemy.spellWhileParole))))
		&& (!enemy.silence || enemy.silence < 0.01)
		&& (!enemy.blind || enemy.blind < 0.01 || AIData.playerDist < 2.99)
		&& (!enemy.Enemy.noSpellDuringAttack || enemy.attackPoints < 1)
		&& (!enemy.Enemy.noSpellsWhenHarmless || !AIData.harmless)
		&& (!enemy.Enemy.noSpellsLowSP || KinkyDungeonHasWill(0.1) || KinkyDungeonFlags.has("PlayerCombat"))
		&& (!enemy.Enemy.noSpellLeashing || KDGameData.KinkyDungeonLeashingEnemy != enemy.id || KDGameData.KinkyDungeonLeashedPlayer < 1)
		&& (!enemy.Enemy.followLeashedOnly || (KDGameData.KinkyDungeonLeashedPlayer < 1 || KDGameData.KinkyDungeonLeashingEnemy == enemy.id) || !AIData.addMoreRestraints)
		&& (KDHostile(enemy) || (!player.player && (KDHostile(player) || enemy.rage)))
		&& ((enemy.aware && (KinkyDungeonTrackSneak(enemy, 0, player) || AIData.playerDist < Math.max(1.5, AIData.blindSight))) || (!KDAllied(enemy) && !KDHostile(enemy)))
		&& !AIData.ignore && (!AIData.moved || enemy.Enemy.castWhileMoving) && enemy.Enemy.attack.includes("Spell")
		&& !AIData.ignoreRanged
		&& AIType.spell(enemy, player, AIData)
		&& KinkyDungeonCheckLOS(enemy, player, AIData.playerDist, AIData.visionRadius, false, true) && enemy.castCooldown <= 0) {
			AIData.idle = false;
			let spellchoice = null;
			let spell = null;
			let spelltarget = undefined;

			for (let tries = 0; tries < 6; tries++) {
				spelltarget = null;
				spellchoice = enemy.Enemy.spells[Math.floor(KDRandom()*enemy.Enemy.spells.length)];
				spell = KinkyDungeonFindSpell(spellchoice, true);
				if (spell && (enemy.blind > 0 && (spell.projectileTargeting))) spell = null;
				if (spell && ((!spell.castRange && AIData.playerDist > spell.range) || (spell.castRange && AIData.playerDist > spell.castRange))) spell = null;
				if (spell && spell.specialCD && enemy.castCooldownSpecial > 0) spell = null;
				if (spell && spell.noFirstChoice && tries <= 2) spell = null;
				if (spell && spell.projectileTargeting && !KinkyDungeonCheckProjectileClearance(enemy.x, enemy.y, player.x, player.y)) spell = null;
				if (spell && spell.buff) {
					if (enemy.Enemy.buffallies) {
					// Select a random nearby ally of the enemy
						let nearAllies = [];
						for (let e of KinkyDungeonEntities) {
							if ((e != enemy) && (!spell.heal || e.hp < e.Enemy.maxhp - spell.power*0.5)
							&& e.aware && !KinkyDungeonHasBuff(e.buffs, spell.name)
							&& !e.rage
							&& ((KDAllied(enemy) && KDAllied(e)) || (KDHostile(enemy) && KDHostile(e) || KDFactionRelation(KDGetFaction(e), KDGetFaction(enemy)) >= 0.1))
							&& Math.sqrt((enemy.x - e.x)*(enemy.x - e.x) + (enemy.y - e.y)*(enemy.y - e.y)) < spell.range) {
								let allow = !spell.filterTags;
								if (spell.filterTags) {
									for (let t of spell.filterTags) {
										if (e.Enemy.tags && e.Enemy.tags[t]) {
											allow = true;
											break;
										}
									}
								}
								if (allow)
									nearAllies.push(e);
							}
						}
						if (nearAllies.length > 0) {
							let e = nearAllies[Math.floor(KDRandom() * nearAllies.length)];
							if (e) {
								spelltarget = e;
								KinkyDungeonSendTextMessage(4, TextGet("KinkyDungeonSpellCast" + spell.name).replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), "white", 2);
								break;
							}
						} else spell = null;
					} else {
						spelltarget = enemy;
					}
				}
				let minSpellRange = (spell && spell.minRange != undefined) ? spell.minRange : ((spell && (spell.selfcast || spell.buff || (spell.range && spell.range < 1.6))) ? 0 : 1.5);
				if (spell && spell.heal && spelltarget.hp >= spelltarget.Enemy.maxhp) spell = null;
				if (spell && !(!minSpellRange || (AIData.playerDist > minSpellRange))) spell = null;
				if (spell && !(!spell.minRange || (AIData.playerDist > spell.minRange))) spell = null;
				if (spell) break;
			}

			if (spell) {
				if (spell.channel && !enemy.Enemy.noChannel) enemy.channel = spell.channel;
				enemy.castCooldown = spell.manacost*enemy.Enemy.spellCooldownMult + enemy.Enemy.spellCooldownMod + 1;
				if (spell.specialCD)
					enemy.castCooldownSpecial = spell.specialCD;
				let xx = player.x;
				let yy = player.y;
				if (spelltarget) {
					xx = spelltarget.x;
					yy = spelltarget.y;
				}
				if (spell && spell.selfcast) {
					xx = enemy.x;
					yy = enemy.y;
					if (!spell.noCastMsg)
						KinkyDungeonSendTextMessage(4, TextGet("KinkyDungeonSpellCast" + spell.name).replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), "white", 2, undefined, undefined, enemy);
				} else if (spell && spell.msg) {
					if (!spell.noCastMsg)
						KinkyDungeonSendTextMessage(4, TextGet("KinkyDungeonSpellCast" + spell.name).replace("EnemyName", TextGet("Name" + enemy.Enemy.name)), "white", 2, undefined, undefined, enemy);
				}

				if (spell && KinkyDungeonCastSpell(xx, yy, spell, enemy, player).result == "Cast" && spell.sfx) {
					if (enemy.Enemy.suicideOnSpell) enemy.hp = 0;
					KinkyDungeonPlaySound(KinkyDungeonRootDirectory + "/Audio/" + spell.sfx + ".ogg", enemy);
				}

			//console.log("casted "+ spell.name);
			}
		}
		if (AIData.vibe || (enemy.Enemy.remote && AIData.playerDist < enemy.Enemy.remote)) {
			KinkyDungeonSendEvent("remoteVibe", {enemy: enemy.Enemy.name, power: enemy.Enemy.remoteAmount ? enemy.Enemy.remoteAmount : 5, overcharge: AIData.vibe, noSound: AIData.vibe});
		}
	}

	if (enemy.IntentAction && KDIntentEvents[enemy.IntentAction] && KDIntentEvents[enemy.IntentAction].maintain) {
		KDIntentEvents[enemy.IntentAction].maintain(enemy, delta);
	}

	if (enemy.usingSpecial && (AIData.idle || (AIData.moved && !enemy.Enemy.attackWhileMoving)) && enemy.Enemy.specialCDonAttack) {
		enemy.specialCD = enemy.Enemy.specialCD;
	}
	if (enemy.specialCD > 0) enemy.usingSpecial = false;

	if (AIData.idle) KDAddThought(enemy.id, "Idle", 1, 3);
	return {idle: AIData.idle, defeat: AIData.defeat};
}

// Unique ID for enemies, to prevent bullets from hitting them
// Dont want to pass object handles around in case we ever allow saving a room
function KinkyDungeonGetEnemyID() {
	if (KinkyDungeonEnemyID > 100000000) KinkyDungeonEnemyID = 0;
	return KinkyDungeonEnemyID++;
}

let KinkyDungeonEnemyID = 1;

function KinkyDungeonNoEnemy(x, y, Player) {

	if (KinkyDungeonEnemyAt(x, y)) return false;
	if (Player)
		for (let player of KinkyDungeonPlayers)
			if ((player.x == x && player.y == y)) return false;
	return true;
}

// e = potential sub
// Enemy = leader
/**
 *
 * @param {entity} e - Target enemy
 * @param {entity} Enemy - Enemy trying to move
 * @returns
 */
function KinkyDungeonCanSwapWith(e, Enemy) {
	if (e.Enemy && e.Enemy.immobile) return false; // Definition of noSwap
	if (e && KDEnemyHasFlag(e, "noswap")) return false; // Definition of noSwap
	if (KinkyDungeonTiles.get(e.x + "," + e.y) && KinkyDungeonTiles.get(e.x + "," + e.y).OffLimits && Enemy != KinkyDungeonJailGuard()) return false; // Only jailguard is allowed to swap into offlimits spaces
	if (Enemy && Enemy.Enemy && Enemy.Enemy.ethereal && e && e.Enemy && !e.Enemy.ethereal) return false; // Ethereal enemies NEVER have seniority, this can teleport other enemies into walls
	if (Enemy && Enemy.Enemy && Enemy.Enemy.squeeze && e && e.Enemy && !e.Enemy.squeeze) return false; // Squeeze enemies NEVER have seniority, this can teleport other enemies into walls
	if (Enemy == KinkyDungeonLeashingEnemy()) return true;
	if (Enemy == KinkyDungeonJailGuard()) return true;
	if (KDBoundEffects(e) > 3) return true;
	if (!e.Enemy.tags || (e.Enemy.tags.minor && !Enemy.Enemy.tags.minor))
		return true;
	else if (Enemy && Enemy.Enemy && Enemy.Enemy.tags && Enemy.Enemy.tags.elite) {
		if (!e.Enemy.tags || (!e.Enemy.tags.elite && !e.Enemy.tags.miniboss && !e.Enemy.tags.boss))
			return true;
	} else if (Enemy && Enemy.Enemy && Enemy.Enemy.tags && Enemy.Enemy.tags.miniboss) {
		if (!e.Enemy.tags || (!e.Enemy.tags.miniboss && !e.Enemy.tags.boss))
			return true;
	} else if (Enemy && Enemy.Enemy && Enemy.Enemy.tags && Enemy.Enemy.tags.boss) {
		if (!e.Enemy.tags || (!e.Enemy.tags.boss))
			return true;
	}
	return false;
}

function KinkyDungeonNoEnemyExceptSub(x, y, Player, Enemy) {
	let e = KinkyDungeonEnemyAt(x, y);
	if (e && e.Enemy) {
		if (e.Enemy.master && Enemy && Enemy.Enemy && e.Enemy.master.type == Enemy.Enemy.name) return true;
		let seniority = Enemy ? KinkyDungeonCanSwapWith(e, Enemy) : false;
		return seniority;
	}
	if (Player)
		for (let pp of KinkyDungeonPlayers)
			if ((pp.x == x && pp.y == y)) return false;
	return true;
}

function KinkyDungeonEnemyAt(x, y) {
	let cache = KDGetEnemyCache();
	if (cache) return cache.get(x + "," + y);
	for (let enemy of KinkyDungeonEntities) {
		if (enemy.x == x && enemy.y == y)
			return enemy;
	}
	return null;
}

function KinkyDungeonEntityAt(x, y, requireVision, vx, vy) {
	if (KinkyDungeonPlayerEntity.x == x && KinkyDungeonPlayerEntity.y == y) return KinkyDungeonPlayerEntity;
	let cache = KDGetEnemyCache();
	if (!requireVision && cache) return cache.get(x + "," + y);
	else if (cache) {
		let enemy = cache.get(x + "," + y);
		if (KDCanSeeEnemy(enemy, KDistEuclidean(x - vx, y - vy))) return enemy;
	}
	for (let enemy of KinkyDungeonEntities) {
		if (enemy.x == x && enemy.y == y && (!requireVision || KDCanSeeEnemy(enemy, KDistEuclidean(x - vx, y - vy))))
			return enemy;
	}
	return null;
}

function KinkyDungeonEnemyTryMove(enemy, Direction, delta, x, y) {
	let speedMult = KinkyDungeonGetBuffedStat(enemy.buffs, "MoveSpeed") ? KinkyDungeonMultiplicativeStat(-KinkyDungeonGetBuffedStat(enemy.buffs, "MoveSpeed")) : 1;
	if (enemy.bind > 0) enemy.movePoints += speedMult * delta/10;
	else if (enemy.slow > 0) enemy.movePoints += speedMult * delta/2;
	else enemy.movePoints += KDGameData.SleepTurns > 0 ? 4*delta * speedMult : delta * speedMult;

	let moveMult = KDBoundEffects(enemy) * 0.5;

	if (enemy.movePoints > 0) {
		enemy.fx = enemy.x + Direction.x;
		enemy.fy = enemy.y + Direction.y;
	}

	if (enemy.movePoints >= enemy.Enemy.movePoints + moveMult) {
		enemy.movePoints = Math.max(0, enemy.movePoints - enemy.Enemy.movePoints + moveMult);
		let dist = Math.abs(x - KinkyDungeonPlayerEntity.x) + Math.abs(y - KinkyDungeonPlayerEntity.y);

		let ee = KinkyDungeonEnemyAt(enemy.x + Direction.x, enemy.y + Direction.y);

		if (!ee && KinkyDungeonMapGet(enemy.x, enemy.y) == 'd' && enemy.Enemy && enemy.Enemy.tags.closedoors && !(KDGameData.KinkyDungeonLeashedPlayer > 0 || KinkyDungeonFlags.has("noclosedoors"))
			&& ((dist > 5) ||
				(KinkyDungeonTiles.get(enemy.x + "," + enemy.y) && KDHostile(enemy) && (KinkyDungeonTiles.get(enemy.x + "," + enemy.y).Jail || KinkyDungeonTiles.get(enemy.x + "," + enemy.y).ReLock) && !KinkyDungeonFlags.has("nojailbreak")))) {
			KinkyDungeonMapSet(enemy.x, enemy.y, 'D');
			if (KDGameData.PrisonerState == 'jail' && KinkyDungeonTiles.get(enemy.x + "," + enemy.y) && KDHostile(enemy) && (KinkyDungeonTiles.get(enemy.x + "," + enemy.y).Jail || KinkyDungeonTiles.get(enemy.x + "," + enemy.y).ReLock)
				&& !KinkyDungeonFlags.has("nojailbreak")) {
				KinkyDungeonTiles.get(enemy.x + "," + enemy.y).Lock = "Red";
				KDUpdateDoorNavMap();
			}
			if (dist < 10) {
				KinkyDungeonSendTextMessage(2, TextGet("KinkyDungeonHearDoorCloseNear"), "#dddddd", 4);
			} else if (dist < 20)
				KinkyDungeonSendTextMessage(1, TextGet("KinkyDungeonHearDoorCloseFar"), "#999999", 4);
		}

		if (ee && KinkyDungeonCanSwapWith(ee, enemy)) {
			KDMoveEntity(ee, enemy.x, enemy.y, false);
			ee.warningTiles = [];
			ee.movePoints = 0;
			ee.stun = 1;
		}
		KDMoveEntity(enemy, enemy.x + Direction.x, enemy.y + Direction.y, true);

		if (KinkyDungeonMapGet(x, y) == 'D' && enemy.Enemy && enemy.Enemy.tags.opendoors) {
			KinkyDungeonMapSet(x, y, 'd');
			if (KinkyDungeonTiles.get(x + ',' +y) && KinkyDungeonTiles.get(x + ',' +y).Type == "Door")
				KinkyDungeonTiles.get(x + ',' +y).Lock = undefined;
			if (dist < 5) {
				KinkyDungeonSendTextMessage(2, TextGet("KinkyDungeonHearDoorOpenNear"), "#dddddd", 4);
			} else if (dist < 15)
				KinkyDungeonSendTextMessage(1, TextGet("KinkyDungeonHearDoorOpenFar"), "#999999", 4);
		}

		return true;
	}
	return false;
}

function KinkyDungeonEnemyTryAttack(enemy, player, Tiles, delta, x, y, points, replace, msgColor, usingSpecial, refreshWarningTiles, attack, MovableTiles) {
	if (!enemy.Enemy.noCancelAttack && !refreshWarningTiles && points > 1) {
		let playerIn = false;
		for (let T = 0; T < Tiles.length; T++) {
			let ax = enemy.x + Tiles[T].x;
			let ay = enemy.y + Tiles[T].y;

			if (player.x == ax && player.y == ay && (!enemy.Enemy.strictAttackLOS || KinkyDungeonCheckProjectileClearance(enemy.x, enemy.y, player.x, player.y))) {
				playerIn = true;
				break;
			}
		}

		if (!playerIn && Tiles.length > 0) {
			if (enemy.Enemy.specialRange && enemy.usingSpecial && enemy.Enemy.specialCDonAttack) {
				enemy.specialCD = enemy.Enemy.specialCD;
				enemy.attackPoints = 0;
				enemy.warningTiles = [];
				enemy.usingSpecial = false;
				if (enemy.Enemy.stunOnSpecialCD) enemy.stun = enemy.Enemy.stunOnSpecialCD;
				if (attack.includes("Dash") && enemy.Enemy.dashOnMiss) {
					KDDash(enemy, player, MovableTiles);
				}
				return false;
			}
			if (enemy.Enemy.specialWidth && enemy.usingSpecial && enemy.Enemy.specialCDonAttack) {
				enemy.specialCD = enemy.Enemy.specialCD;
				enemy.attackPoints = 0;
				enemy.warningTiles = [];
				enemy.usingSpecial = false;
				if (enemy.Enemy.stunOnSpecialCD) enemy.stun = enemy.Enemy.stunOnSpecialCD;
				if (attack.includes("Dash") && enemy.Enemy.dashOnMiss) {
					KDDash(enemy, player, MovableTiles);
				}
				return false;
			}
		}
	}

	enemy.attackPoints += delta;
	KinkyDungeonSetFlag("NPCCombat",  3);

	if (enemy.attackPoints >= points) {
		enemy.attackPoints = 0;
		return true;
	}
	return false;
}

function KinkyDungeonGetWarningTilesAdj() {
	let arr = [];

	arr.push({x:1, y:1});
	arr.push({x:0, y:1});
	arr.push({x:1, y:0});
	arr.push({x:-1, y:-1});
	arr.push({x:-1, y:1});
	arr.push({x:1, y:-1});
	arr.push({x:-1, y:0});
	arr.push({x:0, y:-1});

	return arr;
}

function KDCanPickpocket(enemy) {
	if (KinkyDungeonFlags.has("pickpocket")) return false;
	for (let inv of KinkyDungeonAllRestraint()) {
		if (KDRestraint(inv).enclose) return false;
	}
	return KDHostile(enemy) || ((KDGameData.PrisonerState == 'jail' || KDGameData.PrisonerState == 'parole') && KinkyDungeonPlayerTags.has("Furniture"));
}


function KinkyDungeonGetWarningTiles(dx, dy, range, width, forwardOffset = 1) {
	if (range == 1 && width == 8) return KinkyDungeonGetWarningTilesAdj();

	let arr = [];
	/*
	let cone = 0.78539816 * (width-0.9)/2;
	let angle_player = Math.atan2(dx, dy) + ((width % 2 == 0) ? ((KDRandom() > 0.5) ? -0.39269908 : 39269908) : 0);
	if (angle_player > Math.PI) angle_player -= Math.PI;
	if (angle_player < -Math.PI) angle_player += Math.PI;

	for (let X = -range; X <= range; X++)
		for (let Y = -range; Y <= range; Y++) {
			let angle = Math.atan2(X, Y);

			let angleDiff = angle - angle_player;
			angleDiff += (angleDiff>Math.PI) ? -2*Math.PI : (angleDiff<-Math.PI) ? 2*Math.PI : 0;

			if (Math.abs(angleDiff) < cone + 0.22/Math.max(Math.abs(X), Math.abs(Y)) && Math.sqrt(X*X + Y*Y) < range + 0.5) arr.push({x:X, y:Y});
		}
	*/
	let dist = Math.sqrt(dx*dx + dy*dy);
	let radius = Math.ceil(width/2);
	if (dist > 0) {
		let x_step = dx/dist;
		let y_step = dy/dist;

		for (let d = forwardOffset; d <= range; d++) {
			let xx = x_step * d;
			let yy = y_step * d;
			for (let X = Math.floor(xx-radius); X <= Math.ceil(xx+radius); X++)
				for (let Y = Math.floor(yy-radius); Y <= Math.ceil(yy+radius); Y++) {
					let dd = Math.sqrt((X - xx)*(X - xx) + (Y - yy)*(Y - yy));
					let dd2 = Math.sqrt(X*X+Y*Y);
					if (dd < width*0.49 && dd2 < range + 0.5) {
						let dupe = false;
						for (let a of arr) {
							if (a.x == X && a.y == Y) {dupe = true; break;}
						}
						if (!dupe) arr.push({x:X, y:Y});
					}
				}
		}
	}

	return arr;
}

function KinkyDungeonFindMaster(enemy) {
	let findMaster = undefined;
	let masterDist = 1000;
	if (enemy.Enemy.master) {
		for (let e of KinkyDungeonEntities) {
			if (e.Enemy.name == enemy.Enemy.master.type) {
				let dist = Math.sqrt((e.x - enemy.x) * (e.x - enemy.x) + (e.y - enemy.y)*(e.y - enemy.y));
				if ((!enemy.Enemy.master.maxDist || dist < enemy.Enemy.master.maxDist)
					&& dist < masterDist
					&& (!enemy.Enemy.master.loose || KinkyDungeonCheckLOS(enemy, e, dist, 100, false, false))) {
					masterDist = Math.sqrt((e.x - enemy.x) * (e.x - enemy.x) + (e.y - enemy.y)*(e.y - enemy.y));
					findMaster = e;
				}
			}
		}
	}
	return {master: findMaster, dist: masterDist};
}

function KinkyDungeonEnemyCanMove(enemy, dir, MovableTiles, AvoidTiles, ignoreLocks, Tries) {
	if (!dir) return false;
	let master = enemy.Enemy.master;
	let xx = enemy.x + dir.x;
	let yy = enemy.y + dir.y;
	if (master && (!enemy.Enemy.master.aggressive || !enemy.aware)) {
		let fm = KinkyDungeonFindMaster(enemy);
		let findMaster = fm.master;
		let masterDist = fm.dist;
		if (findMaster) {
			if (Math.sqrt((xx - findMaster.x) * (xx - findMaster.x) + (yy - findMaster.y) * (yy - findMaster.y)) > master.range
				&& Math.sqrt((xx - findMaster.x) * (xx - findMaster.x) + (yy - findMaster.y) * (yy - findMaster.y)) > masterDist) return false;
		}
	}
	return MovableTiles.includes(KinkyDungeonMapGet(xx, yy)) && ((Tries && Tries > 5) || !AvoidTiles.includes(KinkyDungeonMapGet(enemy.x + dir.x, enemy.y + dir.y)))
		&& (ignoreLocks || !KinkyDungeonTiles.get((xx) + "," + (yy)) || !KinkyDungeonTiles.get((xx) + "," + (yy)).Lock)
		&& KinkyDungeonNoEnemyExceptSub(xx, yy, true, enemy);
}

function KinkyDungeonFindID(id) {
	for (let e of KinkyDungeonEntities) {
		if (e.id == id) return e;
	}
	return null;
}

function KDDash(enemy, player, MovableTiles) {
	let happened = 0;
	let Dash = false;
	// Check player neighbor tiles
	let tiles = [];
	for (let X = player.x-1; X <= player.x+1; X++)
		for (let Y = player.y-1; Y <= player.y+1; Y++) {
			let tile = KinkyDungeonMapGet(X, Y);
			if ((X != 0 || Y != 0) && !(!KinkyDungeonNoEnemy(X, Y, true) || !MovableTiles.includes(tile) || (tile == 'D' && !enemy.Enemy.ethereal))) {
				tiles.push({x:X, y:Y});
			}
		}
	if (tiles.length > 0) {
		let tile = tiles[Math.floor(KDRandom()*tiles.length)];
		if (enemy.Enemy.dashThrough) {
			let tiled = 0;
			for (let t of tiles) {
				let dist = Math.sqrt((enemy.x - t.x)*(enemy.x - t.x) + (enemy.y - t.y)*(enemy.y - t.y));
				if (dist > tiled) {
					tile = t;
					tiled = dist;
				}
			}
		} else {
			let tiled = Math.sqrt((enemy.x - tile.x)*(enemy.x - tile.x) + (enemy.y - tile.y)*(enemy.y - tile.y));
			for (let t of tiles) {
				let dist = Math.sqrt((enemy.x - t.x)*(enemy.x - t.x) + (enemy.y - t.y)*(enemy.y - t.y));
				if (dist < tiled) {
					tile = t;
					tiled = dist;
				}
			}
		}
		if (tile && (tile.x != player.x || tile.y != player.y) && (tile.x != KinkyDungeonPlayerEntity.x || tile.y != KinkyDungeonPlayerEntity.y) && MovableTiles.includes(KinkyDungeonMapGet(tile.x, tile.y))) {
			Dash = true;
			KDMoveEntity(enemy, tile.x, tile.y, true);
			enemy.path = undefined;
			happened += 1;
			if (enemy.usingSpecial && enemy.Enemy.specialAttack && enemy.Enemy.specialAttack.includes("Dash")) {
				enemy.specialCD = enemy.Enemy.specialCD;
			}
		}
	}
	return {happened: happened, Dash: Dash};
}

function KinkyDungeonSendEnemyEvent(Event, data) {
	if (!KDMapHasEvent(KDEventMapEnemy, Event)) return;
	for (let enemy of KinkyDungeonEntities) {
		if (enemy.Enemy.events) {
			for (let e of enemy.Enemy.events) {
				if (e.trigger === Event) {
					KinkyDungeonHandleEnemyEvent(Event, e, enemy, data);
				}
			}
		}
	}
}

/**
 *
 * @param {entity} enemy
 * @param {any} data
 * @param {boolean} aggressive
 * @returns {(enemy, AIData) => void}
 */
function KDGetIntentEvent(enemy, data, play, allied, hostile, aggressive) {
	let eventWeightTotal = 0;
	let eventWeights = [];

	for (let event of Object.values(KDIntentEvents)) {
		if (((event.aggressive && aggressive) || (event.nonaggressive && !aggressive))
			&& (!event.play || play)
			&& (!event.noplay || !play)) {
			eventWeights.push({event: event, weight: eventWeightTotal});
			eventWeightTotal += event.weight(enemy, data, allied, hostile, aggressive);
		}
	}

	let selection = KDRandom() * eventWeightTotal;

	for (let L = eventWeights.length - 1; L >= 0; L--) {
		if (selection > eventWeights[L].weight) {
			return eventWeights[L].event.trigger;
		}
	}
	return (e, a) => {};
}

function KDClearItems(enemy) {
	if (enemy.items) {
		for (let item of enemy.items) {
			if (KinkyDungeonFindWeapon(item)) {
				KinkyDungeonAddLostItems([{name: item, type: Weapon}], false);
			} else if (KinkyDungeonFindConsumable(item)) {
				KinkyDungeonAddLostItems([{name: item, type: Consumable, quantity: 1}], false);
			}
		}
		enemy.items = undefined;
	}

}

function KDAddEntity(entity) {
	KinkyDungeonEntities.push(entity);
	if (!entity.data && entity.Enemy.data) entity.data = entity.Enemy.data;
	KDUpdateEnemyCache = true;
}
function KDSpliceIndex(index, num = 1) {
	KinkyDungeonEntities.splice(index, num);
	KDUpdateEnemyCache = true;
}

/**
 *
 * @param {entity} enemy
 * @param {any} target
 * @returns {{x: number, y: number, delta: number}}
 */
function KDGetDir(enemy, target) {
	return (enemy.fx && enemy.fy) ?
		{x: enemy.fx - enemy.x, y: enemy.fy - enemy.y, delta: 1} :
		(AIData.kite ? KinkyDungeonGetDirectionRandom(enemy.x - target.x, enemy.y - target.y) : KinkyDungeonGetDirectionRandom(target.x - enemy.x, target.y - enemy.y));
}

function KDIsImmobile(enemy) {
	return enemy?.Enemy?.immobile || enemy?.Enemy?.tags?.has("immobile");
}

/**
 *
 * @param {entity} enemy
 * @returns {number}
 */
function KDPullResistance(enemy) {
	let tags = enemy?.Enemy?.tags;
	if (!tags) return;
	return tags.unstoppable ? 0.25 : (tags.unflinching ? 0.5 : 1.0);
}

/**
 *
 * @param {number} power
 * @param {entity} enemy
 * @param {boolean} allowNeg
 * @returns {number}
 */
function KDPushModifier(power, enemy, allowNeg = false) {
	let pushPower = power;
	if (KinkyDungeonIsSlowed(enemy) || enemy.bind > 0) pushPower += 1;
	if (KDEntityHasBuff(enemy, "Chilled")) pushPower += 1;
	if (enemy.Enemy.tags.stunimmune) pushPower -= 2;
	else if (enemy.Enemy.tags.stunresist) pushPower -= 1;
	if (enemy.Enemy.tags.unstoppable) pushPower -= 3;
	else if (enemy.Enemy.tags.unflinching || enemy.Enemy.tags.slowresist || enemy.Enemy.tags.slowimmune) pushPower -= 1;
	if (allowNeg) return pushPower;
	return Math.max(0, pushPower);
}