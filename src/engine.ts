// Copyright (c) 2018 Eon S. Jeon <esjeon@hyunmu.am>
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the "Software"),
// to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
// THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.

class Screen {
    public id: number;
    public layout: ILayout;
    public layouts: ILayout[];

    constructor(id: number) {
        this.id = id;
        this.layouts = [
            new TileLayout(),
            new MonocleLayout(),
            new SpreadLayout(),
            new StairLayout(),
        ];
        this.layout = this.layouts[0];
    }
}

class TilingEngine {
    public jiggle: boolean;
    public screens: Screen[];

    private driver: KWinDriver;
    private tiles: Tile[];

    constructor(driver: KWinDriver) {
        this.jiggle = Config.jiggleTiles;
        this.screens = Array();

        this.driver = driver;
        this.tiles = Array();
    }

    public arrange = () => {
        debug(() => "arrange: tiles=" + this.tiles.length);
        this.screens.forEach((screen) => {
            if (screen.layout === null) return;

            const area = this.driver.getWorkingArea(screen.id);
            area.x += Config.screenGapLeft;
            area.y += Config.screenGapTop;
            area.width -= Config.screenGapLeft + Config.screenGapRight;
            area.height -= Config.screenGapTop + Config.screenGapBottom;

            const visibles = this.getVisibleTiles(screen);

            const tileables = visibles.filter((tile) => (tile.isTileable === true));
            screen.layout.apply(tileables, area);

            visibles.forEach((tile) => {
                tile.keepBelow = tile.isTileable;
                if (Config.noTileBorder)
                    tile.noBorder = tile.isTileable;
            });

            if (this.jiggle)
                tileables.forEach((tile) => tile.jiggle());

            tileables.forEach((tile) => tile.commitGeometry(true));
        });
    }

    public arrangeClient = (client: KWin.Client) => {
        const tile = this.getTileByClient(client);
        if (!tile) return;
        if (!tile.isTileable) return;

        tile.commitGeometry();
    }

    public manageClient = (client: KWin.Client): boolean => {
        const className = String(client.resourceClass);

        const ignore = (Config.ignoreClass.indexOf(className) >= 0);
        if (ignore)
            return false;

        const tile = new Tile(client);

        const floating = (
            (Config.floatingClass.indexOf(className) >= 0)
            || (Config.floatUtility && tile.isUtility)
            || client.modal
        );
        if (floating)
            tile.floating = true;

        this.tiles.push(tile);
        this.arrange();
        return true;
    }

    public unmanageClient = (client: KWin.Client) => {
        this.tiles = this.tiles.filter((t) =>
            t.client !== client && !t.isError);
        this.arrange();
    }

    public addScreen = (screenId: number) => {
        this.screens.push(new Screen(screenId));
    }

    public removeScreen = (screenId: number) => {
        this.screens = this.screens.filter((screen) => {
            return screen.id !== screenId;
        });
    }

    /*
     * User Input Handling
     */

    public handleUserInput = (input: UserInput, data?: any) => {
        debug(() => "handleUserInput: input=" + UserInput[input] + " data=" + data);

        const screen = this.getActiveScreen();

        const overriden = screen.layout.handleUserInput(input, data);
        if (overriden) {
            this.arrange();
            return;
        }

        let tile;
        switch (input) {
            case UserInput.Up:
                this.moveFocus(-1);
                break;
            case UserInput.Down:
                this.moveFocus(+1);
                break;
            case UserInput.ShiftUp:
                this.moveTile(-1);
                break;
            case UserInput.ShiftDown:
                this.moveTile(+1);
                break;
            case UserInput.SetMaster:
                if ((tile = this.getActiveTile()))
                    this.setMaster(tile);
                break;
            case UserInput.Float:
                if ((tile = this.getActiveTile())) {
                    tile.toggleFloat();
                    tile.commitGeometry();
                }
                break;
            case UserInput.CycleLayout:
                this.nextLayout();
                break;
            case UserInput.SetLayout:
                this.setLayout(data);
                break;
        }
        this.arrange();
    }

    public moveFocus = (step: number) => {
        if (step === 0) return;

        const tile = this.getActiveTile();
        if (!tile) return;

        const visibles = this.getVisibleTiles(this.getActiveScreen());
        const index = visibles.indexOf(tile);

        let newIndex = index + step;
        while (newIndex < 0)
            newIndex += visibles.length;
        newIndex = newIndex % visibles.length;

        this.driver.setActiveClient(visibles[newIndex].client);
    }

    public moveTile = (step: number) => {
        if (step === 0) return;

        const tile = this.getActiveTile();
        if (!tile) return;

        const screen = this.getActiveScreen();
        let tileIdx = this.tiles.indexOf(tile);
        const dir = (step > 0) ? 1 : -1;
        for (let i = tileIdx + dir; 0 <= i && i < this.tiles.length; i += dir) {
            if (this.isTileVisible(this.tiles[i], screen)) {
                this.tiles[tileIdx] = this.tiles[i];
                this.tiles[i] = tile;
                tileIdx = i;

                step -= dir;
                if (step === 0)
                    break;
            }
        }
    }

    public setMaster = (tile: Tile) => {
        if (this.tiles[0] === tile) return;

        const index = this.tiles.indexOf(tile);
        for (let i = index - 1; i >= 0; i--)
            this.tiles[i + 1] = this.tiles[i];
        this.tiles[0] = tile;
    }

    public setClientFloat = (client: KWin.Client) => {
        const tile = this.getTileByClient(client);
        if (!tile) return;
        if (tile.floating) return;

        tile.floating = true;
        tile.commitGeometry();
    }

    public nextLayout() {
        const screen = this.getActiveScreen();
        const lastLayout = screen.layout;
        let index = screen.layouts.indexOf(screen.layout);

        for (;;) {
            index = (index + 1) % screen.layouts.length;
            if (screen.layouts[index] === lastLayout) break;
            if (screen.layouts[index].isEnabled()) break;
        }
        screen.layout = screen.layouts[index];
    }

    public setLayout(cls: any) {
        try {
            const screen = this.getActiveScreen();
            for (let i = 0; i < screen.layouts.length; i++) {
                if (screen.layouts[i] instanceof cls) {
                    screen.layout = screen.layouts[i];
                    break;
                }
            }
        } catch (e) {
            /* Do nothing on error */
            debug(() => "setLayout" + e);
        }
    }

    /*
     * Privates
     */

    private getActiveScreen = (): Screen => {
        const screenId = this.driver.getActiveClient().screen;
        for (let i = 0; i < this.screens.length; i++)
            if (this.screens[i].id === screenId)
                return this.screens[i];

        /* XXX: suppressing strict type-checker */
        return this.screens[0];
    }

    private getActiveTile = (): Tile | null => {
        /* XXX: may return `null` if the active client is not being managed.
         * I'm just on a defensive manuever, and nothing has been broke actually. */
        return this.getTileByClient(this.driver.getActiveClient());
    }

    private getTileByClient = (client: KWin.Client): Tile | null => {
        for (let i = 0; i < this.tiles.length; i++)
            if (this.tiles[i].client === client)
                return this.tiles[i];
        return null;
    }

    private getVisibleTiles = (screen: Screen): Tile[] => {
        return this.tiles.filter((tile) => this.isTileVisible(tile, screen));
    }

    private isTileVisible = (tile: Tile, screen: Screen): boolean => {
        try {
            return tile.isVisible(screen.id);
        } catch (e) {
            tile.isError = true;
            return false;
        }
    }
}
