import Logger from './lib/log';
import express, {NextFunction, Request, Response} from 'express';
import axios from 'axios';
import sharp from 'sharp';
import settings from '../settings.json';

const logger = new Logger('Server');

const logRequest = (req: Request, res: Response, next: NextFunction) => {
    logger.info(req.originalUrl);
    next();
};

async function getStrava(sw: string, x: string, y: string, zoom: string): Promise<Buffer> {
    const {policy, signature, keyPair} = settings.stravaCookies;

    try {
        const strava = await axios({
            method: 'get',
            url: `https://heatmap-external-${sw}.strava.com/tiles-auth/all/hot/${zoom}/${x}/${y}.png?Key-Pair-Id=${keyPair}&Policy=${policy}&Signature=${signature}`,
            responseType: 'arraybuffer',
        });
        return strava.data;
    } catch (e) {
        logger.error(
            `Strava: (${zoom}, ${x}, ${y}) - ${e?.response?.status}: ${e?.response?.statusText}`
        );
        return sharp({
            create: {
                width: 256,
                height: 256,
                channels: 4,
                background: {
                    r: 0,
                    g: 0,
                    b: 0,
                    alpha: 0,
                },
            },
        })
            .png()
            .toBuffer();
    }
}

async function getDCS(x: string, y: string, zoom: string): Promise<Buffer> {
    try {
        const dcsNSW = await axios({
            method: 'get',
            url: `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/${zoom}/${y}/${x}`,
            responseType: 'arraybuffer',
        });
        return dcsNSW.data;
    } catch (e) {
        logger.error(
            `DCS: (${zoom}, ${x}, ${y}) - ${e?.response?.status}: ${e?.response?.statusText}`
        );
        return sharp({
            create: {
                width: 256,
                height: 256,
                channels: 4,
                background: {
                    r: 0,
                    g: 0,
                    b: 0,
                    alpha: 0,
                },
            },
        })
            .png()
            .toBuffer();
    }
}

export async function runServer(): Promise<void> {
    const port = process.env.PORT || 3000;

    const app = express();
    app.use(logRequest);

    app.get('/:sw/:zoom/:x/:y', async (req, res) => {
        const {sw, x, y, zoom} = req.params;
        const strava = await getStrava(sw, x, y, zoom);
        const dcsNSW = await getDCS(x, y, zoom);

        const dcsImage = sharp(dcsNSW);
        const dcsImageMeta = await dcsImage.metadata();

        const resizedStrava = await sharp(strava)
            .resize(dcsImageMeta.width ?? 256, dcsImageMeta.height ?? 256)
            .png()
            .toBuffer();

        const combined = await dcsImage
            .composite([{input: resizedStrava}])
            .png()
            .toBuffer();

        res.contentType('image/png');
        res.send(combined);
    });

    app.listen(port, () => {
        console.log(`server started on port ${port}`);
    });
}
