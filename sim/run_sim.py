"""JRI MBSE 飛行模擬：從標準輸入讀參數（JSON），用 RocketPy 模擬，結果以一行 JSON 印到標準輸出。

座標：原點在鼻錐尖端，沿箭軸往尾端為正（nose_to_tail）。大氣為標準大氣、無風。
"""
import json
import math
import sys
import warnings
from importlib import metadata

warnings.filterwarnings("ignore")

from rocketpy import Environment, Flight, GenericMotor, Rocket  # noqa: E402


def main() -> None:
    p = json.load(sys.stdin)
    r, nose, fins, m, chute, launch = p["rocket"], p["nose"], p["fins"], p["motor"], p["chute"], p["launch"]
    notes = []

    env = Environment(latitude=launch["latitude"], longitude=launch["longitude"], elevation=launch["elevation_m"])

    curve = [[float(t), float(f)] for t, f in m["thrust_curve"]]
    burn_time = curve[-1][0]
    total_impulse = sum((curve[i + 1][0] - curve[i][0]) * (curve[i + 1][1] + curve[i][1]) / 2 for i in range(len(curve) - 1))
    h, cr = m["chamber_height_m"], m["chamber_radius_m"]
    motor = GenericMotor(
        thrust_source=curve,
        burn_time=burn_time,
        chamber_radius=cr,
        chamber_height=h,
        chamber_position=h / 2 + 0.02,
        propellant_initial_mass=m["propellant_mass_kg"],
        nozzle_radius=m["nozzle_radius_m"],
        dry_mass=m["dry_mass_kg"],
        center_of_dry_mass_position=h / 2,
        dry_inertia=(m["dry_mass_kg"] * (3 * cr**2 + h**2) / 12, m["dry_mass_kg"] * (3 * cr**2 + h**2) / 12, m["dry_mass_kg"] * cr**2 / 2),
        nozzle_position=0,
        coordinate_system_orientation="nozzle_to_combustion_chamber",
    )

    radius, mass, length = r["radius_m"], r["mass_kg"], r["length_m"]
    lateral = mass * (3 * radius**2 + length**2) / 12
    rocket = Rocket(
        radius=radius,
        mass=mass,
        inertia=(lateral, lateral, mass * radius**2 / 2),
        power_off_drag=r["drag_cd"],
        power_on_drag=r["drag_cd"],
        center_of_mass_without_motor=r["cm_from_nose_m"],
        coordinate_system_orientation="nose_to_tail",
    )
    rocket.add_motor(motor, position=length)
    try:
        rocket.add_nose(length=nose["length_m"], kind=nose["kind"], position=0)
    except Exception:
        rocket.add_nose(length=nose["length_m"], kind="ogive", position=0)
        notes.append("鼻錐外形 %s 不被支援，改用 ogive 計算。" % nose["kind"])
    rocket.add_trapezoidal_fins(
        n=int(fins["n"]), root_chord=fins["root_chord_m"], tip_chord=fins["tip_chord_m"], span=fins["span_m"],
        position=fins["position_from_nose_m"], sweep_length=fins["sweep_length_m"],
    )
    rocket.add_parachute(name="main", cd_s=chute["cd_s_m2"], trigger="apogee", lag=chute["lag_s"])

    static_margin = float(rocket.static_margin(0))
    if static_margin < 1.0:
        notes.append("起飛時靜態穩定裕度只有 %.2f 倍徑，低於一般建議的 1.5，飛行可能不穩定。" % static_margin)

    flight = Flight(rocket=rocket, environment=env, rail_length=launch["rail_length_m"], inclination=launch["inclination_deg"], heading=launch["heading_deg"], max_time=1200)

    elevation = float(env.elevation)
    liftoff_mass = mass + m["dry_mass_kg"] + m["propellant_mass_kg"]
    avg_thrust = total_impulse / burn_time if burn_time > 0 else 0.0
    twr = avg_thrust / (liftoff_mass * 9.80665)
    if twr < 5:
        notes.append("平均推重比 %.1f，低於一般建議的 5，離軌速度可能不足。" % twr)
    rail_speed = float(flight.out_of_rail_velocity)
    if rail_speed < 15:
        notes.append("離軌速度 %.1f m/s 偏低（一般建議 15 m/s 以上）。" % rail_speed)

    def out(key, zh, value, unit):
        v = float(value)
        return {"key": key, "zh": zh, "value": round(v, 4) if math.isfinite(v) else 0.0, "unit": unit}

    outputs = [
        out("apogee", "遠地點高度（離地）", flight.apogee - elevation, "m"),
        out("maxSpeed", "最大速度", flight.max_speed, "m/s"),
        out("maxMach", "最大馬赫數", flight.max_mach_number, ""),
        out("maxAcceleration", "最大加速度", flight.max_acceleration, "m/s^2"),
        out("railExitSpeed", "離軌速度", rail_speed, "m/s"),
        out("staticMargin", "起飛靜態穩定裕度", static_margin, "cal"),
        out("railExitStability", "離軌穩定裕度", flight.out_of_rail_stability_margin, "cal"),
        out("thrustToWeight", "平均推重比", twr, ""),
        out("totalImpulse", "總衝量", total_impulse, "N*s"),
        out("liftoffMass", "起飛質量", liftoff_mass, "kg"),
        out("apogeeTime", "到達遠地點時間", flight.apogee_time, "s"),
        out("flightTime", "總飛行時間", flight.t_final, "s"),
        out("impactSpeed", "落地速度", abs(flight.impact_velocity), "m/s"),
        out("drift", "落點水平距離", math.hypot(flight.x_impact, flight.y_impact), "m"),
    ]

    t_final = float(flight.t_final)
    n = 160
    trajectory = [[round(t_final * i / n, 3), round(float(flight.z(t_final * i / n)) - elevation, 2)] for i in range(n + 1)]

    print(json.dumps({"engine": "RocketPy " + metadata.version("rocketpy"), "outputs": outputs, "trajectory": trajectory, "warnings": notes}, ensure_ascii=False))


if __name__ == "__main__":
    main()
