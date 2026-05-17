import asyncio
from playwright.async_api import async_playwright
import json
import os

async def capture_condition(page, code, is_day, name):
    await page.route("https://api.open-meteo.com/v1/forecast*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({
            "current": {"temperature_2m": 20, "weather_code": code, "is_day": is_day, "relative_humidity_2m": 50, "apparent_temperature": 19, "wind_speed_10m": 10, "visibility": 10000, "pressure_msl": 1013},
            "hourly": {"temperature_2m": [20]*48, "weather_code": [code]*48, "is_day": [is_day]*48, "precipitation_probability": [0]*48},
            "daily": {"weather_code": [code]*10, "temperature_2m_max": [22]*10, "temperature_2m_min": [15]*10, "uv_index_max": [5]*10}
        })
    ))
    await page.reload()
    await page.wait_for_selector("#weather[style='display: block;']")
    await page.wait_for_timeout(2000) # Wait for transition
    await page.screenshot(path=f"verification/bg_{name}.png")
    print(f"Captured {name}")

async def run_verification():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        await page.goto(f"file://{os.getcwd()}/index.html")

        # Test 1: Sunny
        await capture_condition(page, 0, 1, "sunny")

        # Test 2: Rainy
        await capture_condition(page, 61, 1, "rainy")

        # Test 3: Clear Night
        await capture_condition(page, 0, 0, "night")

        # Test 4: Thunderstorm
        await capture_condition(page, 95, 1, "thunderstorm")

        # Check Report Button
        await page.click("text=⚙")
        await page.wait_for_timeout(500)
        await page.click("text=Signaler un problème")
        visible = await page.is_visible("text=Température incorrecte")
        print(f"Report options visible: {visible}")
        assert visible is True

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_verification())
