'use strict';

const fs = require('fs');
const fs_ = require('fs-extra');
const path = require('path');
const which = require('which');
const minimist = require('minimist');
const spawn = require('cross-spawn');
const findParentDir = require('find-parent-dir');
const elmCompiler = require('node-elm-compiler');

const packageJson = require('../package.json');
const elmJson = require('../runner/elm.json');

const VERSION = packageJson.version;
const PATH_TO_ELM = which.sync('elm');

process.title = 'elm-bulletproof';

const args = minimist(process.argv.slice(2));

// H E L P E R S

function splitPath(fullpath) {
    const parts = fullpath.split(path.sep);

    if (!parts.length) {
        return parts;
    }

    // when fullpath starts with a slash, the first part is empty string
    return !parts[0].length ? parts.slice(1) : parts;
}

function omit(keys, object) {
    const acc = Object.assign({}, object);

    for (const key of keys) {
        if (key in acc) {
            delete acc[ key ];
        }
    }

    return acc;
}

function findNearestElmPackageDir(filepath) {
    // Try to find an ancestor elm.json
    const result = findParentDir.sync(path.dirname(filepath), 'elm.json');

    // If we didn't find any, fall back on the current working directory.
    return result == null ? process.cwd() : result;
}

function getGeneratedCodeDir(projectRootDir) {
    return path.join(
        projectRootDir,
        'elm-stuff',
        'elm-bulletproof',
        VERSION
    );
}

function spawnCompiler(pathToElm, processArgs, processOpts) {
    const finalOpts = Object.assign(
        { env: process.env },
        processOpts,
        {
            stdio: [ process.stdin, 'ignore', process.stderr ]
        }
    );

    return spawn(pathToElm, processArgs, finalOpts);
}

function compile(filepath, dest, pathToElmBin) {
    return new Promise((resolve, reject) => {
        const compilation = elmCompiler.compile([ filepath ], {
            spawn: spawnCompiler,
            output: dest,
            pathToElm: pathToElmBin
        });

        compilation.on('close', exitCode => {
            if (exitCode === 0) {
                resolve();
            } else {
                reject('Compilation failed');
            }
        });
    });
}

// B U I L D   A N D   R U N

buildAndRun();

function buildAndRun() {
    if (args._.length !== 1) {
        console.log('Bulletproof expects single file.');
        process.exit(1);
    }

    const filepath = args._[ 0 ];

    if (!fs.existsSync(filepath) || !fs.lstatSync(filepath).isFile()) {
        console.log('Bulletproof expects a file.');
        process.exit(1);
    }

    const storiesFilePath = path.resolve(filepath);
    const projectRootDir = findNearestElmPackageDir(storiesFilePath);
    const n = splitPath(projectRootDir).length;
    const projectStoriesDir = splitPath(storiesFilePath).slice(n - 1).slice(0, 1).join(path.sep);
    const projectStoryModule = splitPath(storiesFilePath).slice(n).join('.').replace(/\.elm$/, '');

    const foo = {
        root: projectRootDir,
        stories: projectStoriesDir,
        module: projectStoryModule
    };

    generateAndRun(foo);

    console.log('Bulletproof is running!');
    process.exit(0);
}

function generateAndRun(foo) {
    const generatedCodeDir = getGeneratedCodeDir(foo.root);

    generateELmJson(foo, generatedCodeDir, elmJson);
    generateBulletproofRunner(foo.module, generatedCodeDir);
    process.chdir(generatedCodeDir);

    compile(
        path.join('src', 'Bulletproof', 'Internal', 'Runner.elm'),
        path.resolve(path.join(generatedCodeDir, 'elmBulletproofOutput.js')),
        PATH_TO_ELM
    )
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}


// G E N E R A T E

function readElmJson(projectRootDir) {
    try {
        const jsonPath = path.resolve(path.join(projectRootDir, 'elm.json'));
        const json = fs.readFileSync(jsonPath, 'utf8');

        return JSON.parse(json);
    } catch (err) {
        console.error('Error reading elm.json: ' + err);
        process.exit(1);
    }
}

function mergeElmJson(foo, runnerJson, storiesJson) {
    const direct = Object.assign(
        runnerJson.dependencies.direct,
        storiesJson.dependencies.direct
    );
    const indirect = omit(
        Object.keys(direct),
        Object.assign(
            runnerJson.dependencies.indirect,
            storiesJson.dependencies.indirect
        )
    );

    return Object.assign(
        runnerJson,
        {
            'source-directories': storiesJson[ 'source-directories' ].map(
                folder => path.resolve(path.join(foo.root, folder))
            ).concat([
                'src',
                path.resolve(path.join(foo.root, foo.stories))
            ]),
            dependencies: Object.assign(
                runnerJson.dependencies,
                {
                    direct: direct,
                    indirect: indirect
                }
            )
        }
    );
}

function generateELmJson(foo, generatedCodeDir, runnerJson) {
    const json = JSON.stringify(
        mergeElmJson(foo, runnerJson, readElmJson(foo.root)),
        null,
        4
    );
    const jsonPath = path.join(generatedCodeDir, 'elm.json');

    // Don't write a fresh elm.json if it's going to be the same. If we do,
    // it will update the timestamp on the file, which will cause `elm make`
    // to do a bunch of unnecessary work
    if (!fs.existsSync(jsonPath) || json !== fs.readFileSync(jsonPath, 'utf8')) {
        fs_.ensureFileSync(jsonPath);
        fs.writeFileSync(jsonPath, json);
    }
}

function generateBulletproofRunner(projectStoryModule, generatedCodeDir) {
    const codePath = path.join(generatedCodeDir, 'src', 'Bulletproof', 'Internal', 'Runner.elm');
    const code = `
port module Bulletproof.Internal.Runner exposing (main)

import Bulletproof
import ${projectStoryModule} exposing (stories)


port save_settings : String -> Cmd msg


main : Bulletproof.Program
main =
    Bulletproof.program save_settings stories
    `;

    if (!fs.existsSync(codePath) || code !== fs.readFileSync(codePath, 'utf8')) {
        fs_.ensureFileSync(codePath);
        fs.writeFileSync(codePath, code);
    }
}
