module Story.Example exposing (stories)

import Bulletproof
import Example

stories : List Bulletproof.Story
stories =
    [ Bulletproof.label "Example Application"
    , Bulletproof.story "Example.example"
        (Example.example
            |> Bulletproof.fromHtml
        )
    ]
